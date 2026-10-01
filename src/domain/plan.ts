import type { AdapterOperation } from "./adapter.js";
import type { AdapterSignature } from "./bundle.js";
import type { SourceSnapshot } from "./assets.js";
import type { Coordinate, Digest } from "./identity.js";
import type { DesiredState } from "./resolution.js";
import type { AppliedOperation, Fingerprint, Resource } from "./state.js";

export interface PathIdentity { physicalPath: string; ancestor: { path: string; realPath: string; device: string; inode: string } }
export type TargetSnapshot = { path: string; identity: PathIdentity } & (
  | { kind: "missing" }
  | { kind: "file"; content: string; mode: number }
  | { kind: "symlink"; target: string }
  | { kind: "directory" | "other" }
);
export interface PlanningIO {
  inspect(path: string): Promise<TargetSnapshot>;
  identify(path: string): Promise<PathIdentity>;
}
export type TargetFingerprint = Fingerprint | { kind: "missing" } | { kind: "other" };
export interface ResourcePrecondition { path: string; identity: PathIdentity; fingerprint: TargetFingerprint; mode?: number }
export interface ExpectedOperation {
  id: string; asset: Coordinate; contentDigest: Digest; placementIds: string[]; requirementIds: string[];
  operation: AdapterOperation; installedFingerprint: Fingerprint; previousOperationId?: string;
}
export interface PlannedOperation {
  id: string; asset: Coordinate; placementIds: string[]; resource: Resource;
  type: AdapterOperation["type"] | "remove-owned";
  expectedBefore: TargetFingerprint; requiredCapabilities: string[];
  dependsOn: string[]; reason: "new-placement" | "content-changed" | "requirement-released";
  operation?: AdapterOperation; contentDigest?: Digest; existingOperationId?: string;
}
export interface FileUpdate {
  id: string; dependsOn: string[]; path: string; before: ResourcePrecondition; after: { kind: "file"; content: string; mode: number } | { kind: "symlink"; target: string } | { kind: "missing" };
  operationIds: string[];
}
export interface AssetChange { asset: Coordinate; type: "install" | "update" | "reactivate" | "orphan"; reason: string }
export interface ChangePlan {
  format: "harnessbrew.plan"; version: 1; id: string; requestDigest: Digest; homeIdentity: string; baseRevision: string;
  sourceSnapshots: SourceSnapshot[]; adapterSignatures: AdapterSignature[]; preconditions: ResourcePrecondition[];
  assetChanges: AssetChange[]; operations: PlannedOperation[]; fileUpdates: FileUpdate[];
  expectedOperations: ExpectedOperation[]; retainedOperations: AppliedOperation[];
  desiredState: DesiredState; desiredStateDigest: Digest;
}
