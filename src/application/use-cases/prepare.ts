import { operationCheckpoint } from "../../observability/operation.js";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { randomUUID } from "node:crypto";
import { parseHomeState, type HomeState } from "../../domain/home-state.js";
import { hash } from "../../domain/identity.js";
import { canonicalJson } from "../../domain/validation.js";
import { parseBundleLock, parseBundleManifest } from "../../domain/bundle.js";
import { placementId } from "../../domain/placement.js";
import type { CatalogSnapshot } from "../../domain/catalog.js";
import type { ResolutionRequest } from "../../domain/resolution.js";

import { loadCatalog } from "../../catalog/load.js";
import { resolveRequest } from "../../resolution/resolve.js";
import { planChange } from "../../planning/plan.js";
import { precondition } from "../../planning/resources.js";
import { catalogAssetReader } from "../../ports/planning.js";
import { exists } from "../../execution/files.js";
import { registryFor } from "../adapters.js";
import { cacheDirectory } from "../cache.js";
import { currentDesired } from "../current.js";
import type { ChangeRequest } from "../types.js";
import type { Saved } from "../saved.js";
import type { PreparationContext } from "./context.js";
import { prepareSources } from "./sources.js";
import { prepareAdapterUpgrade } from "./adapter-upgrade.js";
import { prepareAdapter } from "./adapters.js";
import { prepareRepair, planCleanup } from "./maintenance.js";
import { catalogFor } from "./catalog.js";

export async function prepareChange(context: PreparationContext, state: HomeState, request: ChangeRequest): Promise<Saved> {
  const saved: Saved = { format: "harnessbrew.saved-plan", version: 2, id: randomUUID(), home: context.home, homeIdentity: await context.dependencies.planning.identify(path.join(context.home, "CURRENT")), resources: [], request, baseRevision: state.revision, inputs: [], diagnostics: [] };
  const manager = context.dependencies.sources(path.join(context.cache, "sources"));
  if (["tap.add", "tap.update", "bundle.apply"].includes(request.kind)) await cacheDirectory(context.cache, "sources");
  if (request.kind.startsWith("tap.")) return prepareSources(context, state, request, saved, manager);
  if (request.kind === "adapter.upgrade") return prepareAdapterUpgrade(context, state, request, saved);
  if (request.kind === "adapter.add" || request.kind === "adapter.remove") return prepareAdapter(context, state, request, saved);
  if (request.kind === "cleanup") {
    const cleanup = await planCleanup(state, context.home);
    saved.candidate = parseHomeState(cleanup.candidate); saved.contentChecks = cleanup.checks; saved.contentChanges = cleanup.changes; saved.diagnostics = cleanup.diagnostics;
    return saved;
  }
  const releasing = ["asset.remove", "placement.unlink", "bundle.detach"].includes(request.kind);
  const prepared = request.kind === "repair" ? await prepareRepair(context, state, request) : undefined;
  let catalog: CatalogSnapshot = prepared ? prepared.catalog : releasing ? { snapshots: [], selectedSnapshotIds: [], assets: [] } : await catalogFor(state);
  let resolution: ResolutionRequest;
  if (request.kind === "bundle.apply") {
    const file = path.resolve(context.options.cwd, request.file), directory = await realpath(path.dirname(file));
    const manifestBefore = precondition(await context.dependencies.planning.inspect(file));
    const manifest = parseBundleManifest(parseYaml(await readFile(file, "utf8")));
    saved.inputs.push(manifestBefore);
    const lockPath = `${file}.lock.json`, lockBefore = precondition(await context.dependencies.planning.inspect(lockPath));
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
  let repair: { operationIds: string[]; overwriteOwned: boolean; contentDigests?: import("../../domain/identity.js").Digest[]; assetCoordinates?: import("../../domain/identity.js").Coordinate[] } | undefined;
  if (request.kind === "repair") {
    const affected = new Set(prepared!.affected);
    const operations = state.install.operations.filter(op => affected.has(op.asset) && (prepared!.restorations.some(r => state.install.assets.some(a => a.coordinate === op.asset && a.contentDigest === r.digest)) || !request.placement || op.placementIds.includes(placementId(request.placement))));
    repair = { operationIds: operations.map(op => op.id), overwriteOwned: request.overwriteOwned ?? false, contentDigests: prepared!.restorations.map(r => r.digest), assetCoordinates: prepared!.affected };
    saved.restorations = prepared!.restorations; saved.contentChanges = prepared!.changes;
    saved.diagnostics.push("Repair validates the selected assets only; run doctor to inspect overall Home health.");
  }
  operationCheckpoint();
  const desired = request.kind === "repair" ? currentDesired(state) : resolveRequest(state, catalog, resolution);
  const needed = new Set(desired.assets.filter(a => (!repair?.assetCoordinates || repair.assetCoordinates.includes(a.coordinate)) && catalog.assets.some(item => item.manifest.coordinate === a.coordinate && item.contentDigest === a.contentDigest) && state.sources.registrations.find(s => a.coordinate.startsWith(`${s.name}/`))?.trusted).flatMap(a => a.placements.map(p => p.placement.target)));
  operationCheckpoint();
  const registry = await registryFor(state, context.cache, context.options.adapters ?? [], true, needed);
  operationCheckpoint();
  saved.plan = await planChange({ state, desired, catalog, adapters: registry, io: context.dependencies.planning, assets: catalogAssetReader(catalog), home: context.home, userHome: context.options.userHome, requestDigest: hash(canonicalJson(request)), ...(repair ? { repair } : {}) });
  saved.catalog = catalog; return saved;
}
