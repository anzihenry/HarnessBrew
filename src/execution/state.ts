import { outsideRepair } from "../domain/plan.js";
import type { ChangePlan } from "../domain/plan.js";
import { parseHomeState, type HomeState } from "../domain/home-state.js";
import { HarnessError } from "../domain/errors.js";
import { contained } from "../domain/identity.js";
import type { AppliedOperation } from "../domain/state.js";
import { canonicalJson } from "../domain/validation.js";
import { resourceFingerprint } from "../planning/resources.js";
import { nodePlanningIO } from "../ports/planning.js";

/** No kind-specific rendering: records only verified, actual resource results. */
export async function stateAfterExecution(before: HomeState, plan: ChangePlan, revision: string, directories: string[]): Promise<HomeState> {
  const operations: AppliedOperation[] = [];
  for (const expected of plan.expectedOperations) {
    const previous = before.install.operations.find(op => op.id === expected.previousOperationId);
    const actual = resourceFingerprint(await nodePlanningIO.inspect(expected.operation.resource.path), expected.operation.resource);
    if (canonicalJson(actual) !== canonicalJson(expected.installedFingerprint) || !["file", "symlink"].includes(actual.kind)) throw new HarnessError("TARGET_MODIFIED", "Executed resource does not match its planned fingerprint.", { path: expected.operation.resource.path });
    operations.push({ id: expected.id, asset: expected.asset, type: expected.operation.type, resource: expected.operation.resource,
      placementIds: [...expected.placementIds], requirementIds: [...expected.requirementIds], installedFingerprint: expected.installedFingerprint,
      createdDirectories: [...new Set([...(previous?.createdDirectories ?? []), ...directories.filter(dir => contained(dir, expected.operation.resource.path, false))])].sort() });
  }
  for (const operation of plan.retainedOperations) {
    if (!outsideRepair(plan, operation.asset) && canonicalJson(resourceFingerprint(await nodePlanningIO.inspect(operation.resource.path), operation.resource)) !== canonicalJson(operation.installedFingerprint)) throw new HarnessError("TARGET_MODIFIED", "Retained resource changed during execution.");
    operations.push(structuredClone(operation));
  }
  return assembleState(before, plan, revision, operations);
}
export function assembleState(before: HomeState, plan: ChangePlan, revision: string, operations: AppliedOperation[]): HomeState {
  const next = structuredClone(before);
  next.contents = structuredClone(plan.contents);
  next.revision = revision; next.install.revision = revision;
  next.install.owners = structuredClone(plan.desiredState.owners);
  next.install.requirements = structuredClone(plan.desiredState.requirements);
  next.install.operations = operations;
  next.install.assets = plan.desiredState.assets.map(asset => ({ coordinate: asset.coordinate, commit: asset.commit, contentDigest: asset.contentDigest,
    snapshotId: asset.snapshotId, dependencies: [...asset.dependencies], conflicts: [...asset.conflicts], status: "active" as const, operations: operations.filter(op => op.asset === asset.coordinate).map(op => op.id) }));
  for (const previous of before.install.assets) if (!next.install.assets.some(asset => asset.coordinate === previous.coordinate)) next.install.assets.push({ ...previous, operations: [], status: "orphan" });
  next.sources.snapshots = [...new Map([...next.sources.snapshots, ...plan.sourceSnapshots].map(snapshot => [snapshot.id, snapshot])).values()];
  for (const source of plan.desiredState.requiredSources) if (!next.sources.registrations.some(item => item.name === source.name)) next.sources.registrations.push({ ...source, trusted: false });
  return parseHomeState(next);
}
