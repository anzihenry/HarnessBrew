import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { createApplication } from "../src/application/service.js";
import { CacheLeases } from "../src/application/cache-leases.js";
import { ownedCacheDirectory } from "../src/application/cache.js";
import { PLAN_LIFETIME_MS } from "../src/application/retention.js";
import { stableId } from "../src/domain/identity.js";
import { applicationFixture } from "./helpers/application.js";
const limits = { ttlMs: 0, keepNewest: 0, maxBytes: 0 };
async function fixture(t: TestContext) {
  const f = await applicationFixture(t); await f.register();
  const cache = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`);
  const candidate = await ownedCacheDirectory(path.join(cache, "prepared"), randomUUID(), "prepared");
  await mkdir(path.join(candidate, "nested"));
  await writeFile(path.join(candidate, "nested", "a"), "a"); await writeFile(path.join(candidate, "nested", "b"), "b");
  return { ...f, cache, candidate };
}
test("maintenance removes only the reviewed expired objects and retires expired local plan references", async t => {
  const f = await fixture(t);
  const plan = await f.service.plan({ kind: "tap.trust", name: "test/assets" });
  const file = path.join(f.cache, "plans", `${plan.planId}.json`), old = new Date(Date.now() - PLAN_LIFETIME_MS - 1000);
  await utimes(file, old, old);
  const current = await readFile(path.join(f.home, "CURRENT"), "utf8");
  const preview = await f.service.planMaintenance(limits);
  const result = await f.service.applyMaintenance(preview.planId);
  assert.equal(result.status, "complete"); assert.ok(result.deleted.includes(f.candidate)); assert.ok(result.deleted.includes(file));
  assert.equal(result.retiredReferences.length, 1);
  assert.equal(await readFile(path.join(f.home, "CURRENT"), "utf8"), current);
  await assert.rejects(readFile(file), { code: "ENOENT" });
  assert.equal(await f.service.recoverMaintenance(), undefined);
  assert.equal((await f.service.query({ kind: "taps" })).length, 1);
});
test("changed candidate, changed scope, or a new active lease makes maintenance stale", async t => {
  const f = await fixture(t); let preview = await f.service.planMaintenance(limits);
  await writeFile(path.join(f.candidate, "nested", "a"), "external");
  await assert.rejects(f.service.applyMaintenance(preview.planId), { code: "PLAN_STALE" });
  preview = await f.service.planMaintenance(limits);
  const extra = await ownedCacheDirectory(path.join(f.cache, "prepared"), randomUUID(), "prepared");
  await assert.rejects(f.service.applyMaintenance(preview.planId), { code: "PLAN_STALE" });
  await rm(extra, { recursive: true }); preview = await f.service.planMaintenance(limits);
  await new CacheLeases(f.cache).withLease(async () => {
    await assert.rejects(f.service.applyMaintenance(preview.planId), { code: "PLAN_STALE" });
  });
  assert.equal(await readFile(path.join(f.candidate, "nested", "a"), "utf8"), "external");
});
for (const point of ["journal-durable", "quarantined", "delete-recorded", "entry-deleted"]) {
  test(`SIGKILL at maintenance ${point} recovers exactly the remaining reviewed deletion`, { timeout: 15000 }, async t => {
    const f = await fixture(t), preview = await f.service.planMaintenance(limits);
    const child = fork(new URL("./helpers/maintenance-child.js", import.meta.url), [JSON.stringify(f.options), preview.planId, point], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
    t.after(() => child.kill("SIGKILL")); const exited = once(child, "exit");
    await once(child, "message"); child.kill("SIGKILL"); await exited;
    await assert.rejects(f.service.execute({ kind: "tap.trust", name: "test/assets" }), { code: "RECOVERY_REQUIRED" });
    const result = await f.service.recoverMaintenance(); assert.equal(result?.recovered, true); assert.ok(result?.deleted.includes(f.candidate));
    await assert.rejects(readdir(f.candidate), { code: "ENOENT" });
    assert.equal(await f.service.recoverMaintenance(), undefined);
    assert.equal((await f.service.query({ kind: "taps" })).length, 1);
  });
}
test("recovery preserves externally added or modified quarantine data", async t => {
  const f = await fixture(t), preview = await f.service.planMaintenance(limits);
  const interrupted = createApplication(f.options, { maintenanceFault: point => { if (point === "quarantined") throw new Error("simulated crash"); } });
  t.after(() => interrupted.close());
  await assert.rejects(interrupted.applyMaintenance(preview.planId), /simulated crash/u);
  const quarantine = path.join(f.cache, "maintenance", `trash-${preview.planId}`, "0");
  await writeFile(path.join(quarantine, "user-note"), "preserve me");
  await assert.rejects(f.service.recoverMaintenance(), { code: "RECOVERY_CONFLICT" });
  assert.equal(await readFile(path.join(quarantine, "user-note"), "utf8"), "preserve me");
  assert.ok(await readFile(path.join(f.cache, "maintenance", "transaction.json"), "utf8"));
});
