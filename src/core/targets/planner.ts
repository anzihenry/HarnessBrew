import { HarnessBrewError } from "../errors.js";
import { formulaKinds, type FormulaKind } from "../formulas.js";
import type { InstallReceipt } from "../installations.js";
import type { BuiltinTarget } from "../target-capabilities.js";
import { getTargetAdapter } from "./registry.js";
import type { TargetContext, TargetInstallPlan } from "./types.js";

function receiptKind(receipt: InstallReceipt): FormulaKind {
  if (!formulaKinds.includes(receipt.kind as FormulaKind)) {
    throw new HarnessBrewError(`Unsupported formula kind for target planning: ${receipt.kind}`);
  }
  return receipt.kind as FormulaKind;
}

export function planTargetInstall(
  receipt: InstallReceipt,
  target: BuiltinTarget,
  context: TargetContext = {}
): TargetInstallPlan {
  const adapter = getTargetAdapter(target);
  const kind = receiptKind(receipt);
  if (!adapter.supports(kind)) {
    throw new HarnessBrewError(`Formula ${receipt.coordinate} cannot be linked to ${target}: ${kind} is unsupported.`);
  }
  return adapter.plan(receipt, context);
}
