import path from "node:path";
import type { HomeState } from "../domain/home-state.js";
import type { Journal } from "../transactions/journal.js";
import { absolutePath } from "../domain/identity.js";
import { HarnessError } from "../domain/errors.js";

export const PLAN_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export type RetentionKind = "plan" | "prepared" | "restore" | "source" | "plugin" | "revision" | "maintenance-plan" | "unknown";
export interface RetentionPolicy { ttlMs: number; keepNewest: number; maxBytes: number }
export const DEFAULT_RETENTION: Readonly<RetentionPolicy> = { ttlMs: PLAN_LIFETIME_MS, keepNewest: 10, maxBytes: 1024 * 1024 * 1024 };
export interface RetentionObject { path: string; kind: RetentionKind; bytes: number; modifiedAt: number; owned: boolean }
export interface RetentionReference { path: string; reason: string }
export interface RetentionKnowledge { references: RetentionReference[]; activeLease: boolean; unknown: string[] }
export interface RetentionDecision extends RetentionObject { status: "deletable" | "protected" | "unknown"; reasons: string[] }
export interface RetentionReport { objects: RetentionDecision[]; totalBytes: number; retainedBytes: number; protectedBytes: number; overBudgetBytes: number }
export function retentionPolicy(input: Partial<RetentionPolicy> = {}): RetentionPolicy {
  if (Object.keys(input).some(k => !["ttlMs", "keepNewest", "maxBytes"].includes(k))) throw new HarnessError("INVALID_ARGUMENT", "Unknown retention policy field.");
  const policy = { ...DEFAULT_RETENTION, ...input };
  for (const value of Object.values(policy)) if (!Number.isSafeInteger(value) || value < 0) throw new HarnessError("INVALID_ARGUMENT", "Retention limits must be nonnegative safe integers.");
  return policy;
}
export function planExpired(modifiedAt: number, now: number): boolean {
  return Number.isFinite(modifiedAt) && modifiedAt >= 0 && now >= modifiedAt && now - modifiedAt >= PLAN_LIFETIME_MS;
}
const overlaps = (a: string, b: string) => a === b || b.startsWith(`${a}${path.sep}`) || a.startsWith(`${b}${path.sep}`);
/** Protection wins over TTL, count and capacity. Capacity is a report, never authority to delete young data. */
export function evaluateRetention(objects: readonly RetentionObject[], knowledge: RetentionKnowledge, input: Partial<RetentionPolicy> = {}, now = Date.now()): RetentionReport {
  const policy = retentionPolicy(input);
  if (!Number.isSafeInteger(now) || now < 0) throw new HarnessError("INVALID_ARGUMENT", "Invalid retention clock.");
  const newest = new Set<string>();
  for (const kind of new Set(objects.map(o => o.kind))) {
    const eligible = objects.filter(o => o.kind === kind && o.owned && Number.isSafeInteger(o.modifiedAt) && o.modifiedAt >= 0 && o.modifiedAt <= now)
      .sort((a, b) => b.modifiedAt - a.modifiedAt || a.path.localeCompare(b.path));
    for (const o of eligible.slice(0, policy.keepNewest)) newest.add(o.path);
  }
  const decisions: RetentionDecision[] = objects.map(o => {
    absolutePath(o.path);
    if (!o.owned || o.kind === "unknown" || !Number.isSafeInteger(o.bytes) || o.bytes < 0 || !Number.isSafeInteger(o.modifiedAt) || o.modifiedAt < 0 || o.modifiedAt > now) return { ...o, status: "unknown", reasons: ["unverified-object"] };
    if (knowledge.unknown.length) return { ...o, status: "unknown", reasons: [...knowledge.unknown] };
    const reasons = knowledge.references.filter(r => overlaps(o.path, absolutePath(r.path))).map(r => r.reason);
    if (knowledge.activeLease) reasons.push("active-cache-lease");
    if (newest.has(o.path)) reasons.push("keep-newest");
    if (now - o.modifiedAt < policy.ttlMs) reasons.push("within-ttl");
    if ((o.kind === "plan" || o.kind === "maintenance-plan") && !planExpired(o.modifiedAt, now)) reasons.push("valid-plan");
    return { ...o, status: reasons.length ? "protected" : "deletable", reasons: [...new Set(reasons.length ? reasons : ["expired-unreferenced"])] };
  });
  const size = (items: RetentionDecision[]) => items.reduce((n, o) => n + (Number.isSafeInteger(o.bytes) && o.bytes > 0 ? o.bytes : 0), 0);
  const retainedBytes = size(decisions.filter(o => o.status !== "deletable"));
  return { objects: decisions, totalBytes: size(decisions), retainedBytes, protectedBytes: size(decisions.filter(o => o.status === "protected")), overBudgetBytes: Math.max(0, retainedBytes - policy.maxBytes) };
}
/** All catalog snapshots remain query inputs; content origins remain offline repair inputs. */
export function stateReferences(home: string, cache: string, state: HomeState, reason = "current-state"): RetentionReference[] {
  return [path.join(home, "revisions", `${state.revision}.json`),
    ...state.sources.snapshots.map(s => s.contentLocation),
    ...state.contents.flatMap(c => c.origins.map(o => o.snapshot.contentLocation)),
    ...state.adapters.registrations.filter(a => !a.module.startsWith("builtin:") && !a.module.startsWith("supplied:")).map(a => path.join(cache, "plugins", a.signature.slice(7))),
    ...state.quarantines.map(q => q.path)
  ].map(p => ({ path: p, reason }));
}
export function journalReferences(home: string, cache: string, journal: Journal): RetentionReference[] {
  return [...stateReferences(home, cache, journal.beforeState, "journal-before"),
    ...(journal.nextState ? stateReferences(home, cache, journal.nextState, "journal-next") : []),
    { path: path.join(home, "revisions", `${journal.nextRevision}.json`), reason: "journal-next" },
    ...journal.steps.flatMap(s => [s.path, s.temporary]).map(p => ({ path: p, reason: "journal-step" })),
    ...(journal.restorations ?? []).flatMap(r => [r.path, r.quarantine]).map(p => ({ path: p, reason: "journal-restoration" })),
    ...(journal.garbage ?? []).flatMap(r => [r.path, r.quarantine]).map(p => ({ path: p, reason: "journal-garbage" }))];
}
