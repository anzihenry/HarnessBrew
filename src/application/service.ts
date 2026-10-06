import type { Saved } from "./saved.js";
import { prepareChange } from "./use-cases/prepare.js";
import { catalogFor } from "./use-cases/catalog.js";
import { measured } from "../observability/measure.js";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { HarnessError } from "../domain/errors.js";
import { emptyHomeState, parseHomeState, type HomeState } from "../domain/home-state.js";
import { absolutePath, hash, resolveAsset, stableId } from "../domain/identity.js";
import { canonicalJson, record } from "../domain/validation.js";
import { CatalogIndex, sameVersion } from "../domain/catalog-index.js";
import { StateStore } from "../storage/state-store.js";
import { loadCatalog } from "../catalog/load.js";
import { precondition } from "../planning/resources.js";
import { nodePlanningIO, catalogAssetReader } from "../ports/planning.js";
import { TransactionCoordinator, type ExecutionResult } from "../transactions/coordinator.js";
import { atomicDocument, exists, image } from "../execution/files.js";
import { builtinRegistration, registryFor } from "./adapters.js";
import { cacheDirectory } from "./cache.js";
import { parseRequest, parseReadQuery } from "./requests.js";
import { diagnose } from "../diagnostics/doctor.js";
import type { ChangeRequest, HarnessOptions, HarnessService, PlanPreview, ReadQuery, QueryResults, QueryResult } from "./types.js";

export function createHarness(options: HarnessOptions): HarnessService { return new Application(options); }
class Application implements HarnessService {
  private closed = false;
  private readonly store: StateStore;
  private readonly coordinator: TransactionCoordinator;
  private readonly cache: string;
  constructor(private readonly options: HarnessOptions) {
    absolutePath(options.home); absolutePath(options.cwd); absolutePath(options.userHome);
    this.store = new StateStore(options.home); this.coordinator = new TransactionCoordinator(options.home, { store: this.store });
    this.cache = path.join(path.dirname(options.home), `.harnessbrew-cache-${stableId(options.home)}`);
  }
  private check() { if (this.closed) throw new HarnessError("INVALID_ARGUMENT", "Service is closed."); }
  private async initial(): Promise<HomeState> {
    const state = emptyHomeState("uninitialized"); state.adapters.registrations.push(await builtinRegistration());
    for (const value of this.options.adapters ?? []) state.adapters.registrations.push({ name: value.adapter.name, protocol: value.adapter.protocol, module: `supplied:${value.adapter.name}`, version: value.adapter.version, signature: value.signature, capabilities: [...value.capabilities] });
    return parseHomeState(state);
  }
  private async snapshot(): Promise<HomeState> {
    this.check();
    if (await exists(path.join(this.store.home, "CURRENT"))) return this.coordinator.read();
    if (await exists(this.store.home) && (await readdir(this.store.home)).some(name => name !== ".store.lock")) throw new HarnessError("UNSUPPORTED_FORMAT", "Home contains unsupported data; use an empty Home.");
    return this.initial();
  }
  private async initialize(): Promise<void> {
    this.check();
    if (!await exists(path.join(this.store.home, "CURRENT"))) {
      await this.store.initialize(await this.initial());
    }
  }
  private catalog(state: HomeState) { return catalogFor(state); }
  private build(state: HomeState, request: ChangeRequest): Promise<Saved> {
    return measured("prepare", () => prepareChange({ home: this.store.home, cache: this.cache, options: this.options }, state, request));
  }
  async plan(input: ChangeRequest): Promise<PlanPreview> {
    const request = parseRequest(input), saved = await this.build(await this.snapshot(), request);
    await cacheDirectory(this.cache, "plans");
    await atomicDocument(path.join(this.cache, "plans", `${saved.id}.json`), { digest: hash(canonicalJson(saved)), saved });
    return { contentChanges: saved.contentChanges ?? [], planId: saved.id, baseRevision: saved.baseRevision, changes: saved.plan?.assetChanges ?? [{ kind: request.kind, before: await this.snapshot(), after: saved.candidate }], retained: saved.plan?.desiredState.retained ?? [], fileUpdates: saved.plan?.fileUpdates ?? [], operations: saved.plan?.operations ?? [], diagnostics: saved.diagnostics };
  }
  private async validateInputs(saved: Saved): Promise<void> {
    for (const expected of saved.contentChecks ?? []) if (canonicalJson(await image(expected.path, true)) !== canonicalJson(expected.before)) throw new HarnessError("PLAN_STALE", "Content changed after preview.");
    for (const expected of saved.inputs) if (canonicalJson(precondition(await nodePlanningIO.inspect(expected.path))) !== canonicalJson(expected)) throw new HarnessError("PLAN_STALE", "Manifest changed after preview.");
  }
  private async run(saved: Saved, session: import("../transactions/coordinator.js").TransactionSession): Promise<ExecutionResult> {
    await this.validateInputs(saved);
    const current = await session.read();
    if (current.revision !== saved.baseRevision) throw new HarnessError("PLAN_STALE", "State changed after preview.");
    if (saved.candidate) {
      // Signature validation precedes import, including when applying a saved add plan.
      if (saved.request.kind === "adapter.add") await registryFor(saved.candidate, this.cache, this.options.adapters ?? []);
      if (saved.request.kind === "tap.add" || saved.request.kind === "tap.update") await this.catalog(saved.candidate);
      const result = await session.publish(saved.candidate);
      return { ...result, contentChanges: saved.contentChanges ?? [], diagnostics: [...result.diagnostics, ...saved.diagnostics] };
    }
    if (!saved.plan || !saved.catalog) throw new HarnessError("INVALID_PLAN", "Incomplete saved plan.");
    const verified = await loadCatalog(saved.catalog.snapshots, saved.catalog.selectedSnapshotIds);
    if (canonicalJson(verified) !== canonicalJson(saved.catalog)) throw new HarnessError("PLAN_STALE", "Source changed after preview.");
    const registry = await registryFor(current, this.cache, this.options.adapters ?? [], true, new Set(saved.plan.adapterSignatures.map(a => a.name)));
    const result = await session.apply({ plan: saved.plan, catalog: verified, assets: catalogAssetReader(verified), adapters: registry, ...(saved.bundleLock ? { bundleLock: saved.bundleLock } : {}), ...(saved.restorations ? { restorations: saved.restorations } : {}) });
    return { ...result, diagnostics: [...result.diagnostics, ...saved.diagnostics] };
  }
  async execute(input: ChangeRequest): Promise<ExecutionResult> {
    const request = parseRequest(input); await this.initialize();
    if (request.kind === "repair") {
      const saved = await this.build(await this.snapshot(), request);
      return this.coordinator.withSession(session => this.run(saved, session));
    }
    return this.coordinator.withSession(async session => this.run(await this.build(await session.read(), request), session));
  }
  async apply(id: string): Promise<ExecutionResult> {
    this.check();
    if (!/^[a-f0-9-]{36}$/u.test(id)) throw new HarnessError("PLAN_NOT_FOUND", "Unknown plan ID.");
    let saved: Saved;
    try { const file = path.join(this.cache, "plans", `${id}.json`);
      for (const directory of [this.cache, path.dirname(file)]) if (!(await lstat(directory)).isDirectory()) throw new HarnessError("INVALID_PLAN", "Unsafe saved plan directory.");
      if (!(await lstat(file)).isFile()) throw new HarnessError("INVALID_PLAN", "Saved plan must be a regular file.");
      const envelope = JSON.parse(await readFile(file, "utf8")); saved = envelope.saved;
      if (saved.id !== id || saved.format !== "harnessbrew.saved-plan" || saved.version !== 1 || envelope.digest !== hash(canonicalJson(saved)) || (await nodePlanningIO.identify(path.join(saved.home, "CURRENT"))).physicalPath !== (await nodePlanningIO.identify(path.join(this.store.home, "CURRENT"))).physicalPath) throw new HarnessError("INVALID_PLAN", "Saved plan integrity failed.");
    } catch (cause) { if (cause instanceof HarnessError) throw cause; throw new HarnessError("PLAN_NOT_FOUND", "Saved plan is unavailable.", {}, { cause }); }
    if (saved.baseRevision === "uninitialized") {
      if ((await this.snapshot()).revision !== "uninitialized" || !saved.candidate) throw new HarnessError("PLAN_STALE", "Home changed after preview.");
      await this.initialize();
      return this.coordinator.withSession(async session => { const state = await session.read(); const normalized = { ...state, revision: "uninitialized", install: { ...state.install, revision: "uninitialized" } }; if (canonicalJson(normalized) !== canonicalJson(await this.initial())) throw new HarnessError("PLAN_STALE", "Home was changed while initializing the saved plan."); saved.baseRevision = state.revision; saved.candidate!.revision = state.revision; saved.candidate!.install.revision = state.revision; return this.run(saved, session); });
    }
    return this.coordinator.withSession(session => this.run(saved, session));
  }
  async recover() { this.check(); const pending = await exists(path.join(this.store.home, "transaction.json")); await this.coordinator.recover(); return { recovered: pending, diagnostics: [] }; }
  async doctor(query: { coordinate?: string } = {}) { this.check(); try { record(query, "doctor query", ["coordinate"]); if (query.coordinate !== undefined && (typeof query.coordinate !== "string" || !query.coordinate.trim())) throw new Error("Invalid coordinate"); } catch (cause) { throw new HarnessError("INVALID_ARGUMENT", "Invalid doctor query.", {}, { cause }); } return diagnose(this.store, query.coordinate); }
  async query<Q extends ReadQuery>(query: Q): Promise<QueryResults[Q["kind"]]> { return await this.readQuery(parseReadQuery(query)) as QueryResults[Q["kind"]]; }
  private async readQuery(query: ReadQuery): Promise<QueryResult> {
    const state = await this.snapshot();
    record(query, "read query", ["kind", ...(query.kind === "search" ? ["text"] : query.kind === "info" ? ["coordinate"] : [])]);
    if (query.kind === "list") return { contents: state.contents, quarantines: state.quarantines, revision: state.revision, assets: state.install.assets, owners: state.install.owners, requirements: state.install.requirements };
    if (query.kind === "taps") return state.sources.registrations;
    if (query.kind === "adapters") return state.adapters.registrations;
    const catalog = new CatalogIndex(await this.catalog(state));
    if (query.kind === "search") return [...catalog.latest.values()].filter(a => `${a.manifest.coordinate} ${a.manifest.kind} ${a.manifest.description}`.toLowerCase().includes((query.text ?? "").toLowerCase())).map(a => a.manifest);
    if (query.kind === "info") { const candidates = new Map(state.install.assets.map(a => [a.coordinate, a])); const name = resolveAsset([...new Set([...candidates.keys(), ...catalog.latest.keys()])].map(coordinate => ({ coordinate })), query.coordinate).coordinate; return { coordinate: name, available: catalog.latest.get(name) ?? null, installed: candidates.get(name) ?? null, requirements: state.install.requirements.filter(r => r.resolvedAssets.some(p => p.coordinate === name)) }; }
    if (query.kind === "outdated") return state.install.assets.filter(a => a.status === "active").flatMap(asset => { const latest = catalog.latest.get(asset.coordinate); return latest && !sameVersion(asset, { coordinate: latest.manifest.coordinate, ...latest }) ? [{ coordinate: asset.coordinate, installed: asset.commit, available: latest.commit, ownerIds: state.install.requirements.filter(r => r.resolvedAssets.some(p => p.coordinate === asset.coordinate)).map(r => r.ownerId) }] : []; });
    throw new HarnessError("INVALID_ARGUMENT", "Unknown query.");
  }
  async close() { this.closed = true; }
}
