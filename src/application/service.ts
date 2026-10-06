import type { AdapterRegistry } from "../adapters/registry.js";
import { stagePreparation, preparedPublisher } from "./staging.js";
import { CacheLeases } from "./cache-leases.js";
import { PlanStore } from "./plan-store.js";
import { nodeApplicationDependencies, type ApplicationDependencies } from "./dependencies.js";
import type { Saved } from "./saved.js";
import { prepareChange } from "./use-cases/prepare.js";
import { catalogFor } from "./use-cases/catalog.js";
import { measured } from "../observability/measure.js";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { HarnessError } from "../domain/errors.js";
import { emptyHomeState, parseHomeState, type HomeState } from "../domain/home-state.js";
import { absolutePath, resolveAsset, stableId } from "../domain/identity.js";
import { canonicalJson, record } from "../domain/validation.js";
import { CatalogIndex, sameVersion } from "../domain/catalog-index.js";
import { StateStore } from "../storage/state-store.js";
import { loadCatalog } from "../catalog/load.js";
import { precondition } from "../planning/resources.js";
import { catalogAssetReader } from "../ports/planning.js";
import { TransactionCoordinator, type ExecutionResult } from "../transactions/coordinator.js";
import { exists, image } from "../execution/files.js";
import { builtinRegistration, registryFor, verifyRegistryFiles } from "./adapters.js";

import { parseRequest, parseReadQuery } from "./requests.js";
import { diagnose } from "../diagnostics/doctor.js";
import type { ChangeRequest, HarnessOptions, HarnessService, PlanPreview, ReadQuery, QueryResults, QueryResult } from "./types.js";

export function createHarness(options: HarnessOptions): HarnessService { return createApplication(options); }
export function createApplication(options: HarnessOptions, overrides: Partial<ApplicationDependencies> = {}): HarnessService {
  return new Application(options, { ...nodeApplicationDependencies, ...overrides });
}
class Application implements HarnessService {
  private closed = false;
  private readonly store: StateStore;
  private readonly coordinator: TransactionCoordinator;
  private readonly cache: string;
  private readonly plans: PlanStore;
  private readonly leases: CacheLeases;
  constructor(private readonly options: HarnessOptions, private readonly dependencies: ApplicationDependencies) {
    absolutePath(options.home); absolutePath(options.cwd); absolutePath(options.userHome);
    this.store = new StateStore(options.home, { io: dependencies.storage }); this.coordinator = new TransactionCoordinator(options.home, { store: this.store, fault: dependencies.transactionFault });
    this.cache = path.join(path.dirname(options.home), `.harnessbrew-cache-${stableId(options.home)}`);
    this.leases = new CacheLeases(this.cache);
    this.plans = new PlanStore(this.cache, dependencies.documents, dependencies.planning);
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
    return measured("prepare", async () => {
      const saved = await prepareChange({ home: this.store.home, cache: this.cache, options: this.options, dependencies: this.dependencies }, state, request);
      saved.resources = [...new Set([...(saved.catalog?.snapshots ?? saved.candidate?.sources.snapshots ?? []).map(s => s.contentLocation), ...(saved.restorations ?? []).map(r => r.staged), ...state.adapters.registrations.filter(a => !a.module.startsWith("builtin:") && !a.module.startsWith("supplied:")).map(a => path.join(this.cache, "plugins", a.signature.slice(7)))])].sort();
      await stagePreparation(saved, this.cache);
      return saved;
    });
  }
  async plan(input: ChangeRequest): Promise<PlanPreview> {
    this.check();
    return this.leases.withLease(() => this.planProtected(input));
  }
  private async planProtected(input: ChangeRequest): Promise<PlanPreview> {
    const request = parseRequest(input), saved = await this.build(await this.snapshot(), request);
    await this.plans.save(saved);
    return { contentChanges: saved.contentChanges ?? [], planId: saved.id, baseRevision: saved.baseRevision, changes: saved.plan?.assetChanges ?? [{ kind: request.kind, before: await this.snapshot(), after: saved.candidate }], retained: saved.plan?.desiredState.retained ?? [], fileUpdates: saved.plan?.fileUpdates ?? [], operations: saved.plan?.operations ?? [], diagnostics: saved.diagnostics };
  }
  private async validateInputs(saved: Saved): Promise<void> {
    for (const expected of saved.contentChecks ?? []) if (canonicalJson(await image(expected.path, true)) !== canonicalJson(expected.before)) throw new HarnessError("PLAN_STALE", "Content changed after preview.");
    for (const expected of saved.inputs) if (canonicalJson(precondition(await this.dependencies.planning.inspect(expected.path))) !== canonicalJson(expected)) throw new HarnessError("PLAN_STALE", "Manifest changed after preview.");
  }
  private async prepareRuntime(saved: Saved, state: HomeState): Promise<AdapterRegistry | undefined> {
    if (saved.candidate) return saved.request.kind === "adapter.add" ? registryFor(saved.candidate, this.cache, this.options.adapters ?? []) : undefined;
    return registryFor(state, this.cache, this.options.adapters ?? [], true, new Set(saved.plan!.adapterSignatures.map(a => a.name)));
  }
  private async run(saved: Saved, registry: AdapterRegistry | undefined, session: import("../transactions/coordinator.js").TransactionSession): Promise<ExecutionResult> {
    await this.validateInputs(saved);
    const current = await session.read();
    if (current.revision !== saved.baseRevision) throw new HarnessError("PLAN_STALE", "State changed after preview.");
    if (saved.candidate) {
      // Signature validation precedes import, including when applying a saved add plan.
      if (saved.request.kind === "adapter.add") await verifyRegistryFiles(saved.candidate, this.cache, this.options.adapters ?? []);
      if (saved.request.kind === "tap.add" || saved.request.kind === "tap.update") await this.catalog(saved.candidate);
      const result = await session.publish(saved.candidate);
      return { ...result, contentChanges: saved.contentChanges ?? [], diagnostics: [...result.diagnostics, ...saved.diagnostics] };
    }
    if (!saved.plan || !saved.catalog) throw new HarnessError("INVALID_PLAN", "Incomplete saved plan.");
    const verified = await loadCatalog(saved.catalog.snapshots, saved.catalog.selectedSnapshotIds);
    if (canonicalJson(verified) !== canonicalJson(saved.catalog)) throw new HarnessError("PLAN_STALE", "Source changed after preview.");
    await verifyRegistryFiles(current, this.cache, this.options.adapters ?? [], new Set(saved.plan.adapterSignatures.map(a => a.name)));
    if (!registry) throw new HarnessError("INVALID_PLAN", "Missing prepared adapter registry.");
    const prepared = await preparedPublisher(saved, this.cache);
    const result = await session.apply({ plan: saved.plan, catalog: verified, assets: catalogAssetReader(verified), adapters: registry, prepared, ...(saved.bundleLock ? { bundleLock: saved.bundleLock } : {}), ...(saved.restorations ? { restorations: saved.restorations } : {}) });
    return { ...result, diagnostics: [...result.diagnostics, ...saved.diagnostics] };
  }
  async execute(input: ChangeRequest): Promise<ExecutionResult> {
    this.check();
    return this.leases.withLease(() => this.executeProtected(input));
  }
  private async executeProtected(input: ChangeRequest): Promise<ExecutionResult> {
    const request = parseRequest(input); await this.initialize();
    const state = await this.coordinator.withSession(session => session.read());
    const saved = await this.build(state, request);
    const registry = await this.prepareRuntime(saved, state);
    return this.coordinator.withSession(session => this.run(saved, registry, session));
  }

  async apply(id: string): Promise<ExecutionResult> {
    this.check();
    return this.leases.withLease(() => this.applyProtected(id));
  }
  private async applyProtected(id: string): Promise<ExecutionResult> {
    this.check();
    const saved = await this.plans.load(id, this.store.home);
    if (saved.baseRevision === "uninitialized") {
      if ((await this.snapshot()).revision !== "uninitialized" || !saved.candidate) throw new HarnessError("PLAN_STALE", "Home changed after preview.");
      await this.initialize();
      const registry = await this.prepareRuntime(saved, await this.initial());
      return this.coordinator.withSession(async session => { const state = await session.read(); const normalized = { ...state, revision: "uninitialized", install: { ...state.install, revision: "uninitialized" } }; if (canonicalJson(normalized) !== canonicalJson(await this.initial())) throw new HarnessError("PLAN_STALE", "Home was changed while initializing the saved plan."); saved.baseRevision = state.revision; saved.candidate!.revision = state.revision; saved.candidate!.install.revision = state.revision; return this.run(saved, registry, session); });
    }
    const state = await this.coordinator.withSession(session => session.read());
    if (state.revision !== saved.baseRevision) throw new HarnessError("PLAN_STALE", "State changed after preview.");
    const registry = await this.prepareRuntime(saved, state);
    return this.coordinator.withSession(session => this.run(saved, registry, session));
  }
  async recover() { this.check(); const pending = await exists(path.join(this.store.home, "transaction.json")); await this.coordinator.recover(); return { recovered: pending, diagnostics: [] }; }
  async doctor(query: { coordinate?: string } = {}) { this.check(); try { record(query, "doctor query", ["coordinate"]); if (query.coordinate !== undefined && (typeof query.coordinate !== "string" || !query.coordinate.trim())) throw new Error("Invalid coordinate"); } catch (cause) { throw new HarnessError("INVALID_ARGUMENT", "Invalid doctor query.", {}, { cause }); } return diagnose(this.store, query.coordinate); }
  async query<Q extends ReadQuery>(query: Q): Promise<QueryResults[Q["kind"]]> { this.check(); return await this.leases.withLease(() => this.readQuery(parseReadQuery(query))) as QueryResults[Q["kind"]]; }
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
