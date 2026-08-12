import { HarnessBrewError } from "../errors.js";
import path from "node:path";
import { formulaKinds, type FormulaKind } from "../formulas.js";
import type { InstallReceipt } from "../installations.js";
import { getTargetAdapter } from "./registry.js";
import type { TargetContext, TargetInstallPlan, TargetName } from "./types.js";

function receiptKind(receipt: InstallReceipt): FormulaKind {
  if (!formulaKinds.includes(receipt.kind as FormulaKind)) {
    throw new HarnessBrewError(`Unsupported formula kind for target planning: ${receipt.kind}`);
  }
  return receipt.kind as FormulaKind;
}

function frozenClone<T>(value: T): T {
  const clone = structuredClone(value);
  if (typeof clone === "object" && clone !== null) {
    Object.freeze(clone);
    for (const item of Object.values(clone)) frozenCloneInPlace(item);
  }
  return clone;
}

function frozenCloneInPlace(value: unknown): void {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return;
  Object.freeze(value);
  Object.values(value).forEach(frozenCloneInPlace);
}

export function planTargetInstall(
  receipt: InstallReceipt,
  target: TargetName,
  context: TargetContext = {}
): TargetInstallPlan {
  const adapter = getTargetAdapter(target);
  const kind = receiptKind(receipt);
  const capability = adapter.capabilities[kind];
  if (capability === "unsupported") {
    throw new HarnessBrewError(
      `Formula ${receipt.coordinate} cannot be linked to ${target}: ${kind} is unsupported; install it to the Cellar without --target.`
    );
  }
  let plan: TargetInstallPlan;
  try {
    plan = structuredClone(adapter.plan(frozenClone(receipt), frozenClone(context)));
  } catch (error) {
    throw new HarnessBrewError(`Target Adapter ${target} failed to produce a data-only plan: ${(error as Error).message}`);
  }
  if (plan.target !== target || plan.coordinate !== receipt.coordinate || plan.operations.length !== 1) {
    throw new HarnessBrewError(`Invalid installation plan from Target Adapter ${target}.`);
  }
  const operation = plan.operations[0];
  if (operation === undefined || operation.strategy !== capability || !path.isAbsolute(operation.destination)
    || operation.destination === path.parse(operation.destination).root) {
    throw new HarnessBrewError(`Invalid installation operation from Target Adapter ${target}.`);
  }
  if (operation.source !== undefined) {
    const cellar = path.resolve(receipt.cellarPath);
    const source = path.resolve(operation.source);
    if (source !== cellar && !source.startsWith(`${cellar}${path.sep}`)) {
      throw new HarnessBrewError(`Target Adapter ${target} source escapes the Cellar: ${operation.source}`);
    }
  }
  frozenCloneInPlace(plan);
  return plan;
}
