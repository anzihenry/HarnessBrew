export { createHarness } from "./application/service.js";
export type { AdapterUpgradeInspection, ChangeRequest, HarnessOptions, HarnessService, PlanPreview, RecoveryResult, ReadQuery, QueryResult, QueryResults, DoctorFinding, DoctorReport, ExecutionResult } from "./application/types.js";
export { HarnessError } from "./domain/errors.js";
export type { ErrorCode } from "./domain/errors.js";
export type { Placement } from "./domain/placement.js";
export { runCli } from "./cli.js";
export type { CliIO, CliOptions, CliJsonEnvelope, CliJsonError } from "./cli.js";
export { VERSION } from "./version.js";

export type { ContentRecord, ContentChange } from "./domain/content.js";

export type { MaintenancePreview } from "./application/maintenance.js";
export type { RetentionPolicy, RetentionDecision, RetentionReport } from "./application/retention.js";
export type { MaintenanceResult } from "./application/maintenance-execution.js";
export type { OperationOptions, OperationPhase, ProgressEvent, OperationEffect } from "./application/types.js";
