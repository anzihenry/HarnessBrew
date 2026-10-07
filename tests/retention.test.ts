import assert from "node:assert/strict";
import { utimes } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { evaluateRetention, PLAN_LIFETIME_MS, retentionPolicy, stateReferences, journalReferences, type RetentionObject } from "../src/application/retention.js";
import { emptyHomeState } from "../src/domain/home-state.js";
import { stableId } from "../src/domain/identity.js";
import { applicationFixture } from "./helpers/application.js";
const now = 2 * PLAN_LIFETIME_MS;
const object = (name: string, kind: RetentionObject["kind"] = "restore"): RetentionObject => ({ path: `/cache/${name}`, kind, modifiedAt: 1, bytes: 100, owned: true });
const policy = { ttlMs: 100, keepNewest: 0, maxBytes: 50 };
test("references, lease, unknown evidence and quotas never authorize unsafe deletion", () => {
  for (const kind of ["plan", "prepared", "restore", "source", "plugin", "revision"] as const) {
    const obj = object(kind, kind);
    const report = evaluateRetention([obj], { references: [{ path: `${obj.path}/child`, reason: "valid-plan" }], activeLease: false, unknown: [] }, policy, now);
    assert.equal(report.objects[0]?.status, "protected"); assert.equal(report.overBudgetBytes, 50);
    assert.equal(evaluateRetention([obj], { references: [], activeLease: true, unknown: [] }, policy, now).objects[0]?.status, "protected");
    assert.equal(evaluateRetention([obj], { references: [], activeLease: false, unknown: ["corrupt-reference"] }, policy, now).objects[0]?.status, "unknown");
    assert.equal(evaluateRetention([obj], { references: [], activeLease: false, unknown: [] }, policy, now).objects[0]?.status, "deletable");
  }
});
test("TTL and newest retention apply before capacity, invalid clocks and objects fail closed", () => {
  const objects = [object("old"), { ...object("new"), modifiedAt: now - 1 }, { ...object("future"), modifiedAt: now + 1 }, { ...object("user"), owned: false }];
  const r = evaluateRetention(objects, { references: [], activeLease: false, unknown: [] }, { ...policy, keepNewest: 1 }, now);
  assert.deepEqual(r.objects.map(o => o.status), ["deletable", "protected", "unknown", "unknown"]);
  assert.equal(r.overBudgetBytes, 250);
  assert.throws(() => retentionPolicy({ ttlMs: -1 }), { code: "INVALID_ARGUMENT" });
  assert.throws(() => retentionPolicy({ maxBytes: NaN }), { code: "INVALID_ARGUMENT" });
});
test("CURRENT and both journal revisions remain protected including rollback inputs", () => {
  const state = emptyHomeState("before");
  assert.ok(stateReferences("/home", "/cache", state).some(r => r.path === "/home/revisions/before.json"));
  const refs = journalReferences("/home", "/cache", { format: "harnessbrew.journal", version: 1, id: "tx", home: "/home", status: "prepared", beforeState: state, nextRevision: "next", steps: [] });
  const r = evaluateRetention([object("before.json", "revision"), object("next.json", "revision")].map(o => ({ ...o, path: `/home/revisions/${path.basename(o.path)}` })), { references: refs, activeLease: false, unknown: [] }, policy, now);
  assert.ok(r.objects.every(o => o.status === "protected"));
});
test("expired saved plans return PLAN_STALE without applying or silently replanning", async t => {
  const f = await applicationFixture(t);
  const preview = await f.service.plan({ kind: "tap.add", name: "test/assets", url: f.repository });
  const cache = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`);
  const file = path.join(cache, "plans", `${preview.planId}.json`);
  const old = new Date(Date.now() - PLAN_LIFETIME_MS - 1000); await utimes(file, old, old);
  await assert.rejects(f.service.apply(preview.planId), { code: "PLAN_STALE", details: { reason: "expired" } });
});
