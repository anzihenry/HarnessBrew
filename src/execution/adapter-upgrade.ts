import { HarnessError } from "../domain/errors.js";
import { parseHomeState, type HomeState, type AdapterRegistration } from "../domain/home-state.js";
import type { ChangePlan } from "../domain/plan.js";
import { placementId } from "../domain/placement.js";
import { canonicalJson } from "../domain/validation.js";
export interface AdapterUpgrade { before: AdapterRegistration; after: AdapterRegistration }
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
/** Validate the registration transition independently of plugin code. The actual old
 * state remains the journal's rollback evidence; only execution authorization changes. */
export function upgradeExecutionState(before: HomeState, plan: ChangePlan, upgrade?: AdapterUpgrade): HomeState {
  if (!upgrade) return before;
  const { before: old, after } = upgrade;
  if (!equal(before.adapters.registrations.find(a => a.name === old.name), old) || old.name !== after.name || (old.module === "builtin:codex") !== (after.module === "builtin:codex")) throw new HarnessError("ADAPTER_CHANGED", "Registered adapter differs from the authorized transition.");
  if (!plan.adapterSignatures.some(a => a.name === after.name && a.signature === after.signature && a.version === after.version)) throw new HarnessError("INVALID_PLAN", "Upgrade plan lacks the candidate signature.");
  if (!equal(plan.desiredState.owners, before.install.owners) || !equal(plan.desiredState.requirements, before.install.requirements)) throw new HarnessError("INVALID_PLAN", "Adapter upgrade cannot change usage requirements.");
  const active = before.install.assets.filter(a => a.status === "active");
  if (active.length !== plan.desiredState.assets.length || plan.desiredState.assets.some(a => {
    const old = active.find(b => b.coordinate === a.coordinate);
    return !old || !equal([a.commit, a.contentDigest, a.snapshotId, a.dependencies, a.conflicts], [old.commit, old.contentDigest, old.snapshotId, old.dependencies, old.conflicts]);
  })) throw new HarnessError("INVALID_PLAN", "Adapter upgrade cannot change installed assets.");
  const selected = new Set(before.install.requirements.flatMap(r => r.placements.filter(p => p.target === after.name).map(placementId)));
  const unselected = before.install.operations.filter(op => !op.placementIds.some(id => selected.has(id)));
  if (!equal(unselected, plan.retainedOperations.filter(op => unselected.some(old => old.id === op.id))) || plan.expectedOperations.some(op => op.placementIds.some(id => !selected.has(id)))) throw new HarnessError("INVALID_PLAN", "Upgrade must preserve other adapters' operations.");
  const next = structuredClone(before);
  next.adapters.registrations = next.adapters.registrations.map(a => a.name === after.name ? after : a);
  return parseHomeState(next);
}
