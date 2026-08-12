import type { FormulaKind } from "../formulas.js";
import type { InstallReceipt } from "../installations.js";
import type { TargetOperationKind } from "../target-capabilities.js";

export const TARGET_ADAPTER_API_VERSION = 1 as const;
export type TargetName = string;

export type TargetScope = "user" | "project";

export interface TargetContext {
  root?: string;
  scope?: TargetScope;
  projectRoot?: string;
}

export interface PlannedTargetOperation {
  strategy: Exclude<TargetOperationKind, "unsupported">;
  destination: string;
  source?: string;
}

export interface TargetInstallPlan {
  target: TargetName;
  coordinate: string;
  operations: PlannedTargetOperation[];
}

export interface TargetAdapter {
  readonly apiVersion: typeof TARGET_ADAPTER_API_VERSION;
  readonly name: TargetName;
  readonly version: string;
  readonly capabilities: Readonly<Record<FormulaKind, TargetOperationKind>>;
  plan(receipt: InstallReceipt, context?: TargetContext): TargetInstallPlan;
}
