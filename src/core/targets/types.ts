import type { FormulaKind } from "../formulas.js";
import type { InstallReceipt } from "../installations.js";
import type { BuiltinTarget, TargetOperationKind } from "../target-capabilities.js";

export interface TargetContext {
  root?: string;
}

export interface PlannedTargetOperation {
  strategy: Exclude<TargetOperationKind, "unsupported">;
  destination: string;
  source?: string;
}

export interface TargetInstallPlan {
  target: BuiltinTarget;
  coordinate: string;
  operations: PlannedTargetOperation[];
}

export interface TargetAdapter {
  readonly name: BuiltinTarget;
  supports(kind: FormulaKind): boolean;
  plan(receipt: InstallReceipt, context?: TargetContext): TargetInstallPlan;
}
