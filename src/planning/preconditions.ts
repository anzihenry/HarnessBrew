import type { AdapterProvider } from "../domain/adapter.js";
import type { ChangePlan, PlanningIO } from "../domain/plan.js";
import { HarnessError } from "../domain/errors.js";
import { hash, stableId } from "../domain/identity.js";
import { canonicalJson } from "../domain/validation.js";
import { precondition } from "./resources.js";
import path from "node:path";

/** Read-only guard; the future Executor must invoke this while holding its transaction locks. */
export async function assertPlanFresh(plan: ChangePlan, context: { revision: string; home: string; io: PlanningIO; adapters: AdapterProvider }): Promise<void> {
  const { id, ...data } = plan;
  if (plan.format !== "harnessbrew.plan" || plan.version !== 1 || id !== stableId(data) || plan.desiredStateDigest !== hash(canonicalJson(plan.desiredState))) throw new HarnessError("INVALID_PLAN", "Plan identity or desired state digest is invalid.");
  if (plan.baseRevision !== context.revision || plan.homeIdentity !== stableId(await context.io.identify(path.join(context.home, "CURRENT")))) throw new HarnessError("PLAN_STALE", "Plan belongs to another Home or state revision.");
  for (const signature of plan.adapterSignatures) {
    const current = context.adapters.get(signature.name);
    if (current.signature !== signature.signature || current.adapter.version !== signature.version) throw new HarnessError("ADAPTER_CHANGED", "Adapter changed after planning.");
  }
  for (const expected of plan.preconditions) {
    const actual = precondition(await context.io.inspect(expected.path));
    if (canonicalJson(actual) !== canonicalJson(expected)) throw new HarnessError("PLAN_STALE", "Target or parent path changed after planning.", { path: expected.path });
  }
}
