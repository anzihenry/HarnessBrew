import path from "node:path";
import { HarnessError } from "../../domain/errors.js";
import { hash, stableId } from "../../domain/identity.js";
import { canonicalJson } from "../../domain/validation.js";
import type { HomeState } from "../../domain/home-state.js";
import { planChange } from "../../planning/plan.js";
import { catalogAssetReader } from "../../ports/planning.js";
import { inspectAdapterCandidate, registryFor } from "../adapters.js";
import { currentDesired } from "../current.js";
import type { ChangeRequest } from "../types.js";
import type { Saved } from "../saved.js";
import type { PreparationContext } from "./context.js";
import { prepareRepair } from "./maintenance.js";

export async function prepareAdapterUpgrade(context: PreparationContext, state: HomeState, request: Extract<ChangeRequest, { kind: "adapter.upgrade" }>, saved: Saved): Promise<Saved> {
  const module = request.module === "builtin:codex" ? request.module : path.resolve(context.options.cwd, request.module);
  const inspection = await inspectAdapterCandidate(state, request.name, module);
  if (inspection.candidate.signature !== request.authorizedSignature) throw new HarnessError("ADAPTER_CHANGED", "Candidate differs from the explicitly authorized signature.");
  if (request.capabilities.some(c => !inspection.allowedCapabilities.includes(c))) throw new HarnessError("CAPABILITY_DENIED", "Candidate capability grant exceeds permitted operations.");
  if (inspection.affectedBindings.length) throw new HarnessError("ADAPTER_IN_USE", "Bundle upgrades require all affected manifests; joint upgrade is not yet enabled.", { bindings: inspection.affectedBindings });
  if (request.bundleFiles?.length) throw new HarnessError("LOCK_MISMATCH", "No affected Bundle accepts these manifest paths.");
  const after = { ...inspection.candidate, capabilities: [...request.capabilities] };
  const candidate = structuredClone(state);
  candidate.adapters.registrations = candidate.adapters.registrations.map(a => a.name === request.name ? after : a);
  // Digest and capability authorization precede the first candidate import.
  const registry = await registryFor(candidate, context.cache, [], true, new Set([request.name]));
  const snapshots = new Map<string, import("../../domain/assets.js").SourceSnapshot>();
  const assets = new Map<string, import("../../domain/assets.js").ResolvedAsset>();
  for (const coordinate of new Set(inspection.affectedAssets.map(a => a.asset))) {
    const prepared = await prepareRepair(context, state, { kind: "repair", coordinate });
    for (const snapshot of prepared.catalog.snapshots) snapshots.set(snapshot.id, snapshot);
    for (const asset of prepared.catalog.assets) assets.set(`${asset.manifest.coordinate}:${asset.snapshotId}`, asset);
  }
  const catalog = { snapshots: [...snapshots.values()].sort((a,b) => a.id.localeCompare(b.id)), assets: [...assets.values()].sort((a,b) => `${a.manifest.coordinate}:${a.snapshotId}`.localeCompare(`${b.manifest.coordinate}:${b.snapshotId}`)), selectedSnapshotIds: [] };
  saved.version = 3; saved.adapterUpgrade = { before: inspection.current, after };
  saved.catalog = catalog;
  const planningState = structuredClone(candidate);
  planningState.adapters.registrations.find(a => a.name === request.name)!.capabilities = [...new Set([...inspection.current.capabilities, ...after.capabilities])];
  saved.plan = await planChange({ state: planningState, reprojectTarget: request.name, desired: currentDesired(state), catalog, adapters: registry, io: context.dependencies.planning, assets: catalogAssetReader(catalog), home: context.home, userHome: context.options.userHome, requestDigest: hash(canonicalJson(request)) });
  const { id: _id, ...plan } = structuredClone(saved.plan);
  if (!plan.adapterSignatures.some(a => a.name === after.name)) plan.adapterSignatures.push({ name: after.name, version: after.version, signature: after.signature });
  plan.adapterSignatures.sort((a,b) => a.name.localeCompare(b.name));
  saved.plan = { ...plan, id: stableId(plan) };
  saved.diagnostics.push("Candidate code loaded under the explicit signature and capability grant; registration and targets remain unchanged until apply.");
  return saved;
}
