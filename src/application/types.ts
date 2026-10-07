import type { OperationOptions } from "../observability/operation.js";
export type { OperationOptions, OperationPhase, ProgressEvent } from "../observability/operation.js";
export type { OperationEffect } from "../domain/operation.js";
import type { HomeState, SourceRegistration, AdapterRegistration } from "../domain/home-state.js";
import type { AssetManifest, ResolvedAsset } from "../domain/assets.js";
import type { InstalledAsset, UsageRequirement } from "../domain/state.js";
import type { CommitId } from "../domain/identity.js";
import type { AuthorizedAdapter } from "../domain/adapter.js";
import type { Placement } from "../domain/placement.js";
import type { ResolutionRequest } from "../domain/resolution.js";
import type { AppliedOperationType } from "../domain/state.js";
import type { ChangePlan } from "../domain/plan.js";
import type { ExecutionResult } from "../transactions/coordinator.js";
export type ChangeRequest = Exclude<ResolutionRequest, { kind: "bundle.apply" } | { kind: "bundle.detach" }>
  | { kind: "bundle.apply"; file: string; updateLock?: boolean }
  | { kind: "bundle.detach"; binding: string }
  | { kind: "tap.add"; name: string; url: string; ref?: string }
  | { kind: "tap.update"; name?: string; ref?: string; defaultBranch?: boolean; allowRewind?: boolean }
  | { kind: "tap.remove" | "tap.trust" | "tap.untrust"; name: string }
  | { kind: "adapter.add"; module: string; capabilities: AppliedOperationType[] }
  | { kind: "adapter.remove"; name: string }
  | { kind: "adapter.upgrade"; name: string; module: string; authorizedSignature: string; capabilities: AppliedOperationType[]; bundleFiles?: string[] }
  | { kind: "cleanup" }
  | { kind: "repair"; coordinate?: string; all?: boolean; placement?: Placement; overwriteOwned?: boolean; restoreContent?: boolean };
export type ReadQuery = { kind: "list" | "taps" | "adapters" | "outdated" } | { kind: "search"; text?: string } | { kind: "info"; coordinate: string };
export interface QueryResults {
  list: { contents: HomeState["contents"]; quarantines: HomeState["quarantines"]; revision: string; assets: InstalledAsset[]; owners: HomeState["install"]["owners"]; requirements: UsageRequirement[] };
  taps: SourceRegistration[];
  adapters: AdapterRegistration[];
  search: AssetManifest[];
  info: { coordinate: string; available: ResolvedAsset | null; installed: InstalledAsset | null; requirements: UsageRequirement[] };
  outdated: { coordinate: string; installed: CommitId; available: CommitId; ownerIds: string[] }[];
}
export type QueryResult = QueryResults[keyof QueryResults];
import type { DoctorReport } from "../diagnostics/types.js";
export type { DoctorFinding, DoctorReport } from "../diagnostics/types.js";
export interface PlanPreview { contentChanges: import("./content.js").ContentChange[]; planId: string; baseRevision: string; effects: import("../domain/operation.js").OperationEffect[]; changes: (import("../domain/plan.js").AssetChange | { kind: ChangeRequest["kind"]; before: HomeState | AdapterRegistration; after?: HomeState | AdapterRegistration })[]; retained: ChangePlan["desiredState"]["retained"]; fileUpdates: ChangePlan["fileUpdates"]; operations: ChangePlan["operations"]; diagnostics: string[] }
export interface RecoveryResult { recovered: boolean; diagnostics: string[] }
export interface HarnessService {
  applyMaintenance(planId: string, options?: OperationOptions): Promise<import("./maintenance-execution.js").MaintenanceResult>;
  recoverMaintenance(options?: OperationOptions): Promise<import("./maintenance-execution.js").MaintenanceResult | undefined>;
  planMaintenance(policy?: Partial<import("./retention.js").RetentionPolicy>, options?: OperationOptions): Promise<import("./maintenance.js").MaintenancePreview>;
  inspectAdapterUpgrade(input: { name: string; module: string }, options?: OperationOptions): Promise<AdapterUpgradeInspection>;
  plan(request: ChangeRequest, options?: OperationOptions): Promise<PlanPreview>;
  execute(request: ChangeRequest, options?: OperationOptions): Promise<ExecutionResult>;
  apply(planId: string, options?: OperationOptions): Promise<ExecutionResult>;
  recover(options?: OperationOptions): Promise<RecoveryResult>;
  doctor(query?: { coordinate?: string }, options?: OperationOptions): Promise<DoctorReport>;
  query<Q extends ReadQuery>(query: Q, options?: OperationOptions): Promise<QueryResults[Q["kind"]]>;
  close(): Promise<void>;
}
export interface HarnessOptions { home: string; cwd: string; userHome: string; adapters?: readonly AuthorizedAdapter[] }
export type { ExecutionResult };

export interface AdapterUpgradeInspection {
  current: AdapterRegistration;
  candidate: AdapterRegistration;
  signatureCoverage: string[];
  signatureRule: string;
  allowedCapabilities: AppliedOperationType[];
  requiredCapabilities: AppliedOperationType[] | null;
  affectedAssets: { asset: string; placementId: string }[];
  affectedBindings: string[];
}
