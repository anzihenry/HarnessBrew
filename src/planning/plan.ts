import path from "node:path";
import type { AdapterProvider, AssetReader } from "../domain/adapter.js";
import type { CatalogSnapshot } from "../domain/catalog.js";
import { freezeData } from "../domain/catalog.js";
import type { HomeState } from "../domain/home-state.js";
import { parseHomeState } from "../domain/home-state.js";
import { HarnessError } from "../domain/errors.js";
import { dependencyClosure } from "../domain/graph.js";
import { absolutePath, contained, digest, hash, stableId, type Coordinate, type Digest } from "../domain/identity.js";
import { placementId } from "../domain/placement.js";
import type { ChangePlan, ExpectedOperation, FileUpdate, PlannedOperation, PlanningIO, TargetSnapshot } from "../domain/plan.js";
import type { DesiredState } from "../domain/resolution.js";
import type { AppliedOperation, Resource } from "../domain/state.js";
import { resourcesConflict } from "../domain/state.js";
import { canonicalJson, sortBy } from "../domain/validation.js";
import { CatalogIndex } from "../domain/catalog-index.js";
import { assetView } from "./assets.js";
import { validateAdapterPlan } from "./validate.js";
import { desiredFingerprint, editShared, fingerprint, precondition, resourceFingerprint } from "./resources.js";

export interface PlanningRequest {
  state: HomeState; desired: DesiredState; catalog: CatalogSnapshot;
  adapters: AdapterProvider; io: PlanningIO; assets: AssetReader;
  home: string; userHome: string; requestDigest: Digest;
}
/** Produces data-only operations and file groups. No filesystem or state writes. */
export async function planChange(input: PlanningRequest): Promise<ChangePlan> {
  const state = parseHomeState(input.state), desired = freezeData(structuredClone(input.desired));
  if (desired.baseRevision !== state.revision) throw new HarnessError("PLAN_STALE", "Desired state was resolved against another revision.");
  digest(input.requestDigest);
  absolutePath(input.userHome);
  const home = absolutePath(input.home), index = new CatalogIndex(input.catalog);
  const snapshots = new Map<string, TargetSnapshot>();
  const read = async (name: string): Promise<TargetSnapshot> => {
    const normalized = absolutePath(name);
    const cached = snapshots.get(normalized);
    if (cached) return cached;
    const value = await input.io.inspect(normalized);
    if (value.path !== normalized) throw new HarnessError("INVALID_PLAN", "Target snapshot path mismatch.");
    snapshots.set(normalized, value); return value;
  };
  const physical = async (resource: Resource): Promise<Resource> => ({ ...resource, path: (await read(resource.path)).identity.physicalPath });
  const homePath = path.dirname((await input.io.identify(path.join(home, "CURRENT"))).physicalPath);
  const old = new Map<string, AppliedOperation>();
  for (const operation of state.install.operations) {
    const resource = await physical(operation.resource);
    const key = canonicalJson(resource);
    if (old.has(key)) throw new HarnessError("OWNERSHIP_CONFLICT", "Installed resources alias the same physical address.");
    old.set(key, { ...operation, resource });
  }
  const oldResources = [...old.values()].map(op => op.resource);
  for (let i = 0; i < oldResources.length; i++) for (const other of oldResources.slice(i + 1)) {
    if (resourcesConflict(oldResources[i]!, other)) throw new HarnessError("OWNERSHIP_CONFLICT", "Installed physical resources overlap.");
  }
  const expected = new Map<string, ExpectedOperation>();
  const retained: AppliedOperation[] = [];
  const signatures = new Map<string, ChangePlan["adapterSignatures"][number]>();
  for (const asset of desired.assets) {
    const resolved = index.pinned(asset);
    if (resolved && (resolved.snapshotId !== asset.snapshotId || canonicalJson(resolved.manifest.dependencies) !== canonicalJson(asset.dependencies) || canonicalJson(resolved.manifest.conflicts) !== canonicalJson(asset.conflicts))) throw new HarnessError("INVALID_PLAN", "Desired asset differs from its pinned catalog metadata.");
    const installed = state.install.assets.find(item => item.coordinate === asset.coordinate);
    for (const projection of asset.placements) {
      const pid = placementId(projection.placement);
      const previous = [...old.values()].filter(op => op.asset === asset.coordinate && op.placementIds.includes(pid));
      const source = state.sources.registrations.find(source => source.name === asset.coordinate.split("/").slice(0, 2).join("/"));
      // Cleanup and unchanged projections remain possible without loading source or revoked code.
      if ((!resolved || !source?.trusted) && installed?.contentDigest === asset.contentDigest && previous.length) {
        for (const op of previous) {
          const existing = retained.find(value => value.id === op.id);
          if (existing) {
            existing.placementIds = [...new Set([...existing.placementIds, pid])].sort();
            existing.requirementIds = [...new Set([...existing.requirementIds, ...projection.requirementIds])].sort();
          } else retained.push({ ...op, placementIds: [pid], requirementIds: [...projection.requirementIds] });
        }
        continue;
      }
      if (!resolved) throw new HarnessError("SOURCE_NOT_FOUND", `Cannot plan without pinned asset inventory: ${asset.coordinate}`);
      if (!source?.trusted) throw new HarnessError("SOURCE_UNTRUSTED", `Source is untrusted: ${source?.name ?? asset.coordinate}`);
      const authorized = input.adapters.get(projection.placement.target);
      if (authorized.adapter.name !== projection.placement.target) throw new HarnessError("INVALID_PLAN", "Adapter does not match the requested target.");
      const registered = state.adapters.registrations.find(value => value.name === authorized.adapter.name);
      if (!registered || registered.version !== authorized.adapter.version || registered.signature !== authorized.signature) throw new HarnessError("ADAPTER_CHANGED", "Adapter signature differs from registered identity.");
      if (authorized.capabilities.some(capability => !registered.capabilities.includes(capability))) throw new HarnessError("CAPABILITY_DENIED", "Adapter capabilities exceed the local grant.");
      if (!authorized.adapter.supportedKinds.includes(resolved.manifest.kind) || !resolved.manifest.targets.includes(authorized.adapter.name)) throw new HarnessError("TARGET_UNSUPPORTED", "Adapter does not support this asset.");
      signatures.set(registered.name, { name: registered.name, version: registered.version, signature: registered.signature });
      const target = freezeData(authorized.resolvePlacement(projection.placement, input.userHome));
      let raw: unknown;
      try { raw = structuredClone(await authorized.adapter.plan(assetView(resolved, input.assets), target)); }
      catch (cause) {
        if (cause instanceof HarnessError) throw cause;
        throw new HarnessError("ADAPTER_FAILED", "Adapter failed to produce a data-only plan.", { adapter: registered.name }, { cause });
      }
      const operations = validateAdapterPlan(raw, authorized, resolved, target);
      const roots = await Promise.all(target.authorizedRoots.map(root => input.io.identify(path.join(root, ".harnessbrew-boundary"))));
      for (const operation of operations) {
        const resource = await physical(operation.resource);
        if (!roots.some(root => contained(path.dirname(root.physicalPath), resource.path, false))) throw new HarnessError("INVALID_PLAN", "Physical target path escapes authorized roots.");
        if (resourcesConflict(resource, { kind: "path", path: homePath, pathType: "directory" })) throw new HarnessError("INVALID_PLAN", "Target operations cannot overlap the managed Home.");
        const normalized = { ...operation, resource };
        const key = canonicalJson(resource);
        const sourcePath = "sourceRelativePath" in operation ? path.join(home, "content", asset.contentDigest.slice(7), operation.sourceRelativePath) : "";
        const candidate: ExpectedOperation = { id: stableId({ asset: asset.coordinate, resource }), asset: asset.coordinate, contentDigest: asset.contentDigest,
          placementIds: [pid], requirementIds: [...projection.requirementIds].sort(), operation: normalized,
          installedFingerprint: desiredFingerprint(normalized, sourcePath) };
        const existing = expected.get(key);
        if (existing) {
          if (existing.asset !== candidate.asset || existing.contentDigest !== candidate.contentDigest || canonicalJson(existing.operation) !== canonicalJson(candidate.operation)) throw new HarnessError("OWNERSHIP_CONFLICT", "Different projections claim the same physical resource.");
          existing.placementIds = [...new Set([...existing.placementIds, pid])].sort();
          existing.requirementIds = [...new Set([...existing.requirementIds, ...projection.requirementIds])].sort();
        } else expected.set(key, candidate);
      }
    }
  }
  const finalResources = [...expected.values()].map(op => op.operation.resource).concat(retained.map(op => op.resource));
  for (let i = 0; i < finalResources.length; i++) for (const other of finalResources.slice(i + 1)) {
    if (resourcesConflict(finalResources[i]!, other)) throw new HarnessError("OWNERSHIP_CONFLICT", "Planned resources overlap.", { left: finalResources[i], right: other });
  }
  for (const [key, next] of expected) {
    const previous = old.get(key);
    if (previous) next.previousOperationId = previous.id;
  }
  const retainedKeys = new Set(retained.map(op => canonicalJson(op.resource)));
  const operations: PlannedOperation[] = [];
  const originals = new Map<string, TargetSnapshot>();
  // Inspect physical destinations as well: preconditions protect both alias parents and concrete files.
  for (const resource of [...old.values()].map(op => op.resource).concat(finalResources)) originals.set(resource.path, await read(resource.path));
  for (const [key, previous] of old) {
    const current = resourceFingerprint(originals.get(previous.resource.path)!, previous.resource);
    const replacement = expected.get(key);
    if (replacement && (replacement.asset !== previous.asset || replacement.operation.type !== previous.type)) throw new HarnessError("OWNERSHIP_CONFLICT", "Cannot transfer existing ownership to another asset or operation type.");
    if (current.kind !== "missing" && canonicalJson(current) !== canonicalJson(previous.installedFingerprint)) throw new HarnessError("TARGET_MODIFIED", "Owned resource was modified.", { operation: previous.id });
    if (retainedKeys.has(key)) {
      if (current.kind === "missing") throw new HarnessError("TARGET_MODIFIED", "Retained resource is missing; use repair.");
      continue;
    }
    if (!replacement) operations.push({ id: stableId({ remove: previous.id }), asset: previous.asset, placementIds: previous.placementIds, resource: previous.resource,
      type: "remove-owned", existingOperationId: previous.id, expectedBefore: current, requiredCapabilities: [], dependsOn: [], reason: "requirement-released" });
  }
  for (const [key, next] of expected) {
    const snapshot = originals.get(next.operation.resource.path)!;
    const current = resourceFingerprint(snapshot, next.operation.resource);
    const previous = old.get(key);
    if (!previous && current.kind !== "missing") throw new HarnessError("OWNERSHIP_CONFLICT", "Target resource exists without ownership.", { resource: next.operation.resource });
    const sameMode = next.operation.type !== "write-file" || snapshot.kind === "file" && snapshot.mode === next.operation.mode;
    if (previous && canonicalJson(current) === canonicalJson(next.installedFingerprint) && sameMode) continue;
    if (previous && current.kind === "missing") throw new HarnessError("TARGET_MODIFIED", "Owned resource is missing; use repair.");
    operations.push({ id: next.id, asset: next.asset, placementIds: next.placementIds, resource: next.operation.resource, type: next.operation.type,
      contentDigest: next.contentDigest, ...(previous ? { existingOperationId: previous.id } : {}), expectedBefore: current, requiredCapabilities: [next.operation.type], dependsOn: [], reason: previous ? "content-changed" : "new-placement", operation: next.operation });
  }
  // Reject parent/child transitions across the old and new sets; a separate release avoids ambiguous writes.
  for (const removed of operations.filter(op => op.type === "remove-owned")) for (const added of expected.values()) {
    if (resourcesConflict(removed.resource, added.operation.resource)) throw new HarnessError("OWNERSHIP_CONFLICT", "Release overlapping ownership before projecting a new resource.");
  }
  const graph = new Map(desired.assets.map(asset => [asset.coordinate, asset]));
  const oldGraph = new Map(state.install.assets.map(asset => [asset.coordinate, asset]));
  const rank = new Map<Coordinate, number>();
  for (const asset of desired.assets) for (const node of dependencyClosure(asset.coordinate, name => graph.get(name))) if (!rank.has(node.coordinate)) rank.set(node.coordinate, rank.size);
  for (const operation of operations) {
    if (operation.type === "remove-owned") {
      operation.dependsOn = operations.filter(other => other.type === "remove-owned" && other.asset !== operation.asset && dependencyClosure(other.asset, name => oldGraph.get(name)).some(node => node.coordinate === operation.asset)).map(op => op.id).sort();
    } else {
      const dependencies = new Set(dependencyClosure(operation.asset, name => graph.get(name)).map(asset => asset.coordinate)); dependencies.delete(operation.asset);
      operation.dependsOn = operations.filter(other => other.type === "remove-owned" || dependencies.has(other.asset)).map(op => op.id).sort();
    }
  }
  const ordered: PlannedOperation[] = [], pending = new Map(operations.map(op => [op.id, op]));
  while (pending.size) {
    const ready = [...pending.values()].filter(op => op.dependsOn.every(id => !pending.has(id))).sort((a, b) => (rank.get(a.asset) ?? 0) - (rank.get(b.asset) ?? 0) || a.id.localeCompare(b.id));
    if (!ready.length) throw new HarnessError("INVALID_PLAN", "Operation dependency cycle.");
    for (const op of ready) { ordered.push(op); pending.delete(op.id); }
  }
  const fileUpdates: FileUpdate[] = [];
  for (const destination of [...new Set(ordered.map(op => op.resource.path))].sort()) {
    const changes = ordered.filter(op => op.resource.path === destination), before = originals.get(destination)!;
    if (before.kind === "missing" && changes.every(op => op.type === "remove-owned")) continue;
    let after: FileUpdate["after"];
    if (changes.every(op => op.resource.kind !== "path")) {
      if (before.kind !== "file" && before.kind !== "missing") throw new HarnessError("OWNERSHIP_CONFLICT", "Shared edits require a regular file.");
      let content = before.kind === "file" ? before.content : "";
      for (const op of changes) content = editShared(content, op.resource, op.operation);
      after = { kind: "file", content, mode: before.kind === "file" ? before.mode : 0o644 };
    } else {
      if (changes.length !== 1) throw new HarnessError("OWNERSHIP_CONFLICT", "Exclusive file has multiple writers.");
      const op = changes[0]!;
      if (op.type === "remove-owned") after = { kind: "missing" };
      else if (op.operation?.type === "write-file") after = { kind: "file", content: op.operation.content, mode: op.operation.mode };
      else {
        const desired = expected.get(canonicalJson(op.resource))!.installedFingerprint;
        if (desired.kind !== "symlink") throw new HarnessError("INVALID_PLAN", "Expected link payload.");
        after = { kind: "symlink", target: desired.target };
      }
    }
    if (canonicalJson(fingerprint({ ...before, ...after } as TargetSnapshot)) !== canonicalJson(fingerprint(before)) || after.kind === "file" && before.kind === "file" && after.mode !== before.mode) {
      fileUpdates.push({ id: stableId({ file: destination }), dependsOn: [], path: destination, before: precondition(before), after, operationIds: changes.map(op => op.id) });
    }
  }
  for (const group of fileUpdates) {
    const dependencies = new Set(ordered.filter(op => group.operationIds.includes(op.id)).flatMap(op => op.dependsOn));
    group.dependsOn = fileUpdates.filter(other => other.id !== group.id && other.operationIds.some(id => dependencies.has(id))).map(other => other.id).sort();
  }
  const orderedGroups: FileUpdate[] = [], pendingGroups = new Map(fileUpdates.map(group => [group.id, group]));
  while (pendingGroups.size) {
    const ready = sortBy([...pendingGroups.values()].filter(group => group.dependsOn.every(id => !pendingGroups.has(id))), group => group.path);
    if (!ready.length) throw new HarnessError("INVALID_PLAN", "Shared file updates introduce an operation ordering cycle.");
    for (const group of ready) { orderedGroups.push(group); pendingGroups.delete(group.id); }
  }
  // Validate the proposed ownership graph using the same invariants as committed state.
  // These predicted fingerprints are for validation only; Executor must record actual results.
  const proposedOperations: AppliedOperation[] = [...expected.values()].map(op => ({ id: op.id, asset: op.asset,
    type: op.operation.type, resource: op.operation.resource, placementIds: op.placementIds, requirementIds: op.requirementIds,
    installedFingerprint: op.installedFingerprint, createdDirectories: [] as string[] })).concat(retained);
  const allSnapshots = new Map(state.sources.snapshots.map(snapshot => [snapshot.id, snapshot]));
  for (const snapshot of index.snapshot.snapshots) {
    const previous = allSnapshots.get(snapshot.id);
    if (previous && canonicalJson(previous) !== canonicalJson(snapshot)) throw new HarnessError("SOURCE_MISMATCH", "Catalog snapshot identity changed.");
    allSnapshots.set(snapshot.id, snapshot);
  }
  const registrations = [...state.sources.registrations];
  for (const source of desired.requiredSources) {
    const previous = registrations.find(item => item.name === source.name);
    if (previous && previous.url !== source.url) throw new HarnessError("SOURCE_MISMATCH", "Required source URL differs from registration.");
    if (!previous) registrations.push({ ...source, trusted: false });
  }
  parseHomeState({ ...state, sources: { ...state.sources, registrations, snapshots: [...allSnapshots.values()] }, install: {
    format: "harnessbrew.install-state", version: 1, revision: state.revision, owners: desired.owners, requirements: desired.requirements,
    assets: desired.assets.map(asset => ({ coordinate: asset.coordinate, commit: asset.commit, contentDigest: asset.contentDigest,
      snapshotId: asset.snapshotId, dependencies: asset.dependencies, conflicts: asset.conflicts, status: "active",
      operations: proposedOperations.filter(op => op.asset === asset.coordinate).map(op => op.id) })).concat(
        state.install.assets.filter(asset => !graph.has(asset.coordinate)).map(asset => ({ ...asset, status: "orphan", operations: [] }))),
    operations: proposedOperations
  } });
  const assetChanges: ChangePlan["assetChanges"] = [];
  for (const asset of desired.assets) {
    const previous = state.install.assets.find(item => item.coordinate === asset.coordinate);
    const type = !previous ? "install" : previous.status === "orphan" ? "reactivate" : previous.contentDigest !== asset.contentDigest || canonicalJson(previous.commit) !== canonicalJson(asset.commit) ? "update" : undefined;
    if (type) assetChanges.push({ asset: asset.coordinate, type, reason: type === "update" ? "resolved-version-changed" : "requirement-added" });
  }
  for (const asset of state.install.assets) if (asset.status === "active" && !graph.has(asset.coordinate)) assetChanges.push({ asset: asset.coordinate, type: "orphan", reason: "last-requirement-released" });
  const data = { format: "harnessbrew.plan" as const, version: 1 as const, requestDigest: input.requestDigest,
    homeIdentity: stableId(await input.io.identify(path.join(home, "CURRENT"))), userHome: absolutePath(input.userHome), baseRevision: state.revision,
    sourceSnapshots: sortBy([...allSnapshots.values()].filter(snapshot => desired.assets.some(asset => asset.snapshotId === snapshot.id)), snapshot => snapshot.id),
    adapterSignatures: sortBy([...signatures.values()], value => value.name), preconditions: sortBy([...snapshots.values()].map(precondition), value => value.path),
    assetChanges: sortBy(assetChanges, value => value.asset), operations: ordered, fileUpdates: orderedGroups,
    expectedOperations: sortBy([...expected.values()], op => op.id), retainedOperations: sortBy(retained, op => op.id),
    desiredState: desired, desiredStateDigest: hash(canonicalJson(desired)) };
  return freezeData({ ...data, id: stableId(data) });
}
