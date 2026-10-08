import assert from "node:assert/strict";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createApplication } from "../src/application/service.js";
import { stableId } from "../src/domain/identity.js";
import { applicationFixture } from "./helpers/application.js";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
for (const checkpoint of ["prepared", "before-write", "after-write", "after-record", "before-state", "after-state"]) {
  test(`abort at ${checkpoint} safely rolls back before returning`, async t => {
    const f = await applicationFixture(t); await f.add("a"); await f.register();
    const before = await readFile(path.join(f.home, "CURRENT"), "utf8"), controller = new AbortController();
    const service = createApplication(f.options, { transactionFault: point => { if (point === checkpoint) controller.abort(); } }); t.after(() => service.close());
    await assert.rejects(service.execute({ kind: "asset.install", coordinate: "a", placements: [f.placement] }, { signal: controller.signal }), { code: "OPERATION_ABORTED" });
    assert.equal(await readFile(path.join(f.home, "CURRENT"), "utf8"), before);
    assert.ok(!(await readdir(f.home)).includes("transaction.json"));
    assert.equal((await f.service.query({ kind: "list" })).assets.length, 0);
  });
}
test("deadline does not interrupt rollback and a post-commit abort still returns committed", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  const before = await readFile(path.join(f.home, "CURRENT"), "utf8"); let rolledBack = false;
  const service = createApplication(f.options, { transactionFault: async point => { if (point === "before-state") await sleep(1100); if (point === "before-rollback") { await sleep(50); rolledBack = true; } } }); t.after(() => service.close());
  await assert.rejects(service.execute({ kind: "asset.install", coordinate: "a", placements: [f.placement] }, { timeoutMs: 1000 }), { code: "OPERATION_TIMEOUT" });
  assert.ok(rolledBack); assert.equal(await readFile(path.join(f.home, "CURRENT"), "utf8"), before);
  const controller = new AbortController(), committed = createApplication(f.options, { transactionFault: point => { if (point === "committed") controller.abort(); } }); t.after(() => committed.close());
  const result = await committed.execute({ kind: "asset.install", coordinate: "a", placements: [f.placement] }, { signal: controller.signal });
  assert.equal(result.outcome, "committed"); assert.equal(result.maintenance, "complete");
  assert.ok(!(await readdir(f.home)).includes("transaction.json"));
});
test("cancellation does not override a recovery conflict or overwrite an external target change", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  const controller = new AbortController(); let changed = "";
  const service = createApplication(f.options, { transactionFault: async (point, context) => {
    if (point === "after-record" && context.path?.endsWith(`${path.sep}a`)) { changed = context.path; await rm(changed); await writeFile(changed, "external content"); controller.abort(); }
  } }); t.after(() => service.close());
  await assert.rejects(service.execute({ kind: "asset.install", coordinate: "a", placements: [f.placement] }, { signal: controller.signal }), { code: "RECOVERY_REQUIRED" });
  assert.ok(changed); assert.equal(await readFile(changed, "utf8"), "external content");
  assert.ok((await readdir(f.home)).includes("transaction.json"));
});
test("close rejects new work, waits accepted operation and leases, and is idempotent", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  let resume!: () => void, ready!: () => void;
  const prepared = new Promise<void>(r => { ready = r; });
  const service = createApplication(f.options, { preparationCheckpoint: async () => { ready(); await new Promise<void>(r => { resume = r; }); } });
  const operation = service.execute({ kind: "asset.install", coordinate: "a", placements: [f.placement] }); await prepared;
  let closed = false; const closing = service.close(); void closing.then(() => { closed = true; });
  assert.equal(service.close(), closing);
  await assert.rejects(service.query({ kind: "list" }), { code: "INVALID_ARGUMENT" });
  const cache = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`);
  assert.ok((await readdir(path.join(cache, "leases"))).length > 0); assert.equal(closed, false);
  resume(); assert.equal((await operation).outcome, "committed"); await closing;
  assert.equal(closed, true); assert.deepEqual(await readdir(path.join(cache, "leases")), []);
});
test("reentrant close in a progress callback cannot close the accepted operation prematurely", async t => {
  const f = await applicationFixture(t); await f.register();
  const service = createApplication(f.options); let closing: Promise<void> | undefined;
  const result = await service.query({ kind: "list" }, { onProgress: () => { closing ??= service.close(); } });
  assert.ok(result.revision); await closing; await assert.rejects(service.query({ kind: "list" }), { code: "INVALID_ARGUMENT" });
});

test("metadata abort restores CURRENT; cancellation after maintenance intent completes its recoverable deletion", async t => {
  const f = await applicationFixture(t); await f.register();
  const before = await readFile(path.join(f.home, "CURRENT"), "utf8"), controller = new AbortController();
  const service = createApplication(f.options, { transactionFault: point => { if (point === "after-state") controller.abort(); } }); t.after(() => service.close());
  await assert.rejects(service.execute({ kind: "tap.untrust", name: "test/assets" }, { signal: controller.signal }), { code: "OPERATION_ABORTED" });
  assert.equal(await readFile(path.join(f.home, "CURRENT"), "utf8"), before);
  const preview = await f.service.planMaintenance({ ttlMs: 0, keepNewest: 0 }), maintenanceAbort = new AbortController();
  const maintenance = createApplication(f.options, { maintenanceFault: point => { if (point === "journal-durable") maintenanceAbort.abort(); } }); t.after(() => maintenance.close());
  const result = await maintenance.applyMaintenance(preview.planId, { signal: maintenanceAbort.signal });
  assert.equal(result.status, "complete"); assert.ok(result.deleted.length > 0);
  assert.equal(await readFile(path.join(f.home, "CURRENT"), "utf8"), before);
});
