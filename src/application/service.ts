import { planCleanup, type ContentCheck } from "./content.js";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { randomUUID } from "node:crypto";
import { HarnessError } from "../domain/errors.js";
import { emptyHomeState, parseHomeState, type HomeState } from "../domain/home-state.js";
import { absolutePath, hash, resolveAsset, stableId, tapName } from "../domain/identity.js";
import { canonicalJson, record } from "../domain/validation.js";
import { parseBundleLock, parseBundleManifest } from "../domain/bundle.js";
import { placementId } from "../domain/placement.js";
import type { CatalogSnapshot } from "../domain/catalog.js";
import type { ResolutionRequest } from "../domain/resolution.js";
import { CatalogIndex, sameVersion } from "../domain/catalog-index.js";
import { StateStore } from "../storage/state-store.js";
import { SourceManager } from "../sources/manager.js";
import { loadCatalog } from "../catalog/load.js";
import { resolveRequest } from "../resolution/resolve.js";
import { planChange } from "../planning/plan.js";
import { precondition } from "../planning/resources.js";
import { nodePlanningIO, catalogAssetReader } from "../ports/planning.js";
import { TransactionCoordinator, type ExecutionInput, type ExecutionResult } from "../transactions/coordinator.js";
import { atomicDocument, exists, image } from "../execution/files.js";
import { builtinRegistration, inspectPlugin, registryFor } from "./adapters.js";
import { cacheDirectory } from "./cache.js";
import { parseRequest, parseReadQuery } from "./requests.js";
import { currentDesired } from "./current.js";
import { diagnose } from "../diagnostics/doctor.js";
import type { ChangeRequest, HarnessOptions, HarnessService, PlanPreview, ReadQuery, QueryResults, QueryResult } from "./types.js";
import type { ResourcePrecondition } from "../domain/plan.js";

type Saved = { contentChecks?: ContentCheck[]; contentChanges?: import("./content.js").ContentChange[]; format: "harnessbrew.saved-plan"; version: 1; id: string; home: string; request: ChangeRequest; baseRevision: string; candidate?: HomeState; plan?: ExecutionInput["plan"]; catalog?: CatalogSnapshot; bundleLock?: ExecutionInput["bundleLock"]; inputs: ResourcePrecondition[]; diagnostics: string[] };
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
    if (await exists(this.store.home) && (await readdir(this.store.home)).length) throw new HarnessError("UNSUPPORTED_FORMAT", "Home contains unsupported data; use an empty Home.");
    return this.initial();
  }
  private async initialize(): Promise<void> {
    this.check();
    if (!await exists(path.join(this.store.home, "CURRENT"))) {
      await this.store.initialize(await this.initial());
    }
  }
  private async catalog(state: HomeState): Promise<CatalogSnapshot> {
    const needed = new Set([...state.sources.registrations.flatMap(s => s.selectedSnapshot ? [s.selectedSnapshot] : []), ...state.install.assets.filter(a => a.status === "active").map(a => a.snapshotId)]);
    return loadCatalog(state.sources.snapshots.filter(s => needed.has(s.id)), state.sources.registrations.flatMap(s => s.selectedSnapshot ? [s.selectedSnapshot] : []));
  }
  private async build(state: HomeState, request: ChangeRequest): Promise<Saved> {
    const saved: Saved = { format: "harnessbrew.saved-plan", version: 1, id: randomUUID(), home: this.store.home, request, baseRevision: state.revision, inputs: [], diagnostics: [] };
    const next = structuredClone(state);
    const manager = new SourceManager(path.join(this.cache, "sources"));
    if (["tap.add", "tap.update", "bundle.apply"].includes(request.kind)) await cacheDirectory(this.cache, "sources");
    if (request.kind.startsWith("tap.")) {
      const sourceRequest = request as Extract<ChangeRequest, { kind: "tap.add" | "tap.update" | "tap.remove" | "tap.trust" | "tap.untrust" }>;
      const name = sourceRequest.name === undefined ? undefined : tapName(sourceRequest.name);
      if (request.kind === "tap.add") {
        if (next.sources.registrations.some(s => s.name === name)) throw new HarnessError("INVALID_ARGUMENT", "Tap is already registered.");
        const snapshot = await manager.prepare({ name: name!, url: request.url, ...(request.ref ? { ref: request.ref } : {}) });
        await loadCatalog([snapshot], [snapshot.id]);
        next.sources.snapshots.push(snapshot); next.sources.registrations.push({ name: name!, url: request.url, trusted: false, selectedSnapshot: snapshot.id });
      } else if (request.kind === "tap.update") {
        const sources = next.sources.registrations.filter(s => name === undefined || s.name === name);
        if (name && !sources.length) throw new HarnessError("SOURCE_NOT_FOUND", "Tap is not registered.");
        for (const source of sources) {
          const previous = next.sources.snapshots.find(s => s.id === source.selectedSnapshot);
          const snapshot = await manager.prepare({ name: source.name, url: source.url, ...(request.ref ? { ref: request.ref } : {}), ...(previous ? { previous } : {}), ...(request.allowRewind === undefined ? {} : { allowRewind: request.allowRewind }) });
          await loadCatalog([snapshot], [snapshot.id]);
          if (!next.sources.snapshots.some(s => s.id === snapshot.id)) next.sources.snapshots.push(snapshot);
          source.selectedSnapshot = snapshot.id;
        }
      } else {
        const source = next.sources.registrations.find(s => s.name === name);
        if (!source) throw new HarnessError("SOURCE_NOT_FOUND", "Tap is not registered.");
        if (request.kind === "tap.remove") {
          if (state.install.assets.some(a => a.status === "active" && a.coordinate.startsWith(`${name}/`))) throw new HarnessError("SOURCE_IN_USE", "Tap has active requirements.");
          next.sources.registrations = next.sources.registrations.filter(s => s.name !== name);
          next.sources.snapshots = next.sources.snapshots.filter(s => s.tap !== name || next.install.assets.some(a => a.snapshotId === s.id));
        } else source.trusted = request.kind === "tap.trust";
      }
      saved.candidate = parseHomeState(next); return saved;
    }
    if (request.kind === "adapter.add" || request.kind === "adapter.remove") {
      if (request.kind === "adapter.remove") {
        if (state.install.requirements.some(req => req.placements.some(p => p.target === request.name))) throw new HarnessError("ADAPTER_IN_USE", "Release active placements before removing the adapter.");
        if (!next.adapters.registrations.some(a => a.name === request.name)) throw new HarnessError("TARGET_UNSUPPORTED", "Adapter is not registered.");
        next.adapters.registrations = next.adapters.registrations.filter(a => a.name !== request.name);
      } else {
        const registration = request.module === "builtin:codex" ? await builtinRegistration() : await inspectPlugin(path.resolve(this.options.cwd, request.module), request.capabilities);
        if (next.adapters.registrations.some(a => a.name === registration.name)) throw new HarnessError("INVALID_ARGUMENT", "Remove the existing adapter before registering another version.");
        next.adapters.registrations.push(registration);
        saved.diagnostics.push("Plugin exports will be checked during authorized execution; preview does not import new plugin code.");
      }
      saved.candidate = parseHomeState(next); return saved;
    }
    if (request.kind === "cleanup") {
      const cleanup = await planCleanup(state, this.store.home);
      saved.candidate = parseHomeState(cleanup.candidate); saved.contentChecks = cleanup.checks; saved.contentChanges = cleanup.changes; saved.diagnostics = cleanup.diagnostics;
      return saved;
    }
    const releasing = ["asset.remove", "placement.unlink", "bundle.detach"].includes(request.kind);
    let catalog: CatalogSnapshot = releasing ? { snapshots: [], selectedSnapshotIds: [], assets: [] } : await this.catalog(state);
    let resolution: ResolutionRequest;
    if (request.kind === "bundle.apply") {
      const file = path.resolve(this.options.cwd, request.file), directory = await realpath(path.dirname(file));
      const manifestBefore = precondition(await nodePlanningIO.inspect(file));
      const manifest = parseBundleManifest(parseYaml(await readFile(file, "utf8")));
      saved.inputs.push(manifestBefore);
      const lockPath = `${file}.lock.json`, lockBefore = precondition(await nodePlanningIO.inspect(lockPath));
      const lock = await exists(lockPath) ? parseBundleLock(JSON.parse(await readFile(lockPath, "utf8"))) : undefined;
      const snapshots = new Map(catalog.snapshots.map(s => [s.id, s]));
      const selected = new Map(catalog.selectedSnapshotIds.map(id => { const s = snapshots.get(id)!; return [s.tap, s.id]; }));
      for (const source of manifest.sources) {
        if (lock && !request.updateLock) {
          for (const commit of lock.sources.find(s => s.name === source.name)?.commits ?? []) {
            const snapshot = await manager.prepare({ name: source.name, url: source.git, commit }); snapshots.set(snapshot.id, snapshot);
          }
        } else {
          const snapshot = await manager.prepare({ name: source.name, url: source.git, ...(source.ref ? { ref: source.ref } : {}) }); snapshots.set(snapshot.id, snapshot); selected.set(source.name, snapshot.id);
        }
      }
      catalog = await loadCatalog([...snapshots.values()], [...selected.values()]);
      resolution = { kind: "bundle.apply", manifest, directory, ...(lock ? { lock } : {}), ...(request.updateLock === undefined ? {} : { updateLock: request.updateLock }) };
      saved.bundleLock = { path: lockPath, before: lockBefore };
    } else if (request.kind === "bundle.detach") resolution = { kind: "bundle.detach", ownerId: request.binding };
    else if (request.kind !== "repair") resolution = request as ResolutionRequest;
    else resolution = { kind: "asset.upgrade" }; // repair uses the exact committed desired state below.
    let repair: { operationIds: string[]; overwriteOwned: boolean } | undefined;
    if (request.kind === "repair") {
      const asset = resolveAsset(state.install.assets.filter(a => a.status === "active"), request.coordinate);
      if (!state.sources.registrations.find(s => asset.coordinate.startsWith(`${s.name}/`))?.trusted) throw new HarnessError("SOURCE_UNTRUSTED", "Repair requires a trusted source.");
      const operations = state.install.operations.filter(op => op.asset === asset.coordinate && (!request.placement || op.placementIds.includes(placementId(request.placement))));
      if (!operations.length) throw new HarnessError("INVALID_ARGUMENT", "No matching managed placement to repair.");
      repair = { operationIds: operations.map(op => op.id), overwriteOwned: request.overwriteOwned ?? false };
    }
    const desired = request.kind === "repair" ? currentDesired(state) : resolveRequest(state, catalog, resolution);
    const needed = new Set(desired.assets.filter(a => catalog.assets.some(item => item.manifest.coordinate === a.coordinate && item.contentDigest === a.contentDigest) && state.sources.registrations.find(s => a.coordinate.startsWith(`${s.name}/`))?.trusted).flatMap(a => a.placements.map(p => p.placement.target)));
    const registry = await registryFor(state, this.cache, this.options.adapters ?? [], true, needed);
    saved.plan = await planChange({ state, desired, catalog, adapters: registry, io: nodePlanningIO, assets: catalogAssetReader(catalog), home: this.store.home, userHome: this.options.userHome, requestDigest: hash(canonicalJson(request)), ...(repair ? { repair } : {}) });
    saved.catalog = catalog; return saved;
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
    return session.apply({ plan: saved.plan, catalog: verified, assets: catalogAssetReader(verified), adapters: registry, ...(saved.bundleLock ? { bundleLock: saved.bundleLock } : {}) });
  }
  async execute(input: ChangeRequest): Promise<ExecutionResult> {
    const request = parseRequest(input); await this.initialize();
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
    if (query.kind === "list") return { revision: state.revision, assets: state.install.assets, owners: state.install.owners, requirements: state.install.requirements };
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
