import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createApplication } from "../src/application/service.js";
import { stableId } from "../src/domain/identity.js";
import { upgradeFixture } from "./helpers/adapter-upgrade.js";
import { bundleFixture } from "./helpers/adapter-bundles.js";

test("upgrade preparation blocks maintenance and close drains its live lease", async t => {
  const f = await upgradeFixture(t), request = await f.request();
  const stale = await f.service.planMaintenance({ ttlMs: 0, keepNewest: 0 });
  let resume!: () => void, ready!: () => void;
  const prepared = new Promise<void>(resolve => { ready = resolve; });
  const gate = new Promise<void>(resolve => { resume = resolve; });
  const service = createApplication(f.options, { preparationCheckpoint: async () => { ready(); await gate; } });
  t.after(() => service.close());
  const operation = service.execute(request);
  try {
    await prepared;
    const preview = await f.service.planMaintenance({ ttlMs: 0, keepNewest: 0 });
    assert.ok(preview.objects.some(o => o.reasons.includes("active-cache-lease")));
    assert.ok(preview.objects.every(o => o.status !== "deletable"));
    await assert.rejects(f.service.applyMaintenance(stale.planId), { code: "PLAN_STALE" });
    const cache = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`);
    let closed = false;
    const closing = service.close().then(() => { closed = true; });
    assert.ok((await readdir(path.join(cache, "leases"))).length > 0);
    assert.equal(closed, false);
    resume(); assert.equal((await operation).outcome, "committed"); await closing;
    assert.deepEqual(await readdir(path.join(cache, "leases")), []);
  } finally { resume(); await operation.catch(() => {}); }
});

test("multi-Bundle upgrade cancellation restores locks; committed cleanup failure remains committed", async t => {
  const f = await bundleFixture(t), request = { ...await f.request(), bundleFiles: f.files };
  const current = await readFile(path.join(f.home, "CURRENT"));
  const locks = await Promise.all(f.files.map(file => readFile(`${file}.lock.json`)));
  const controller = new AbortController(); let recordedLocks = 0;
  const cancel = createApplication(f.options, { transactionFault: (point, context) => {
    if (point === "after-record" && context.path?.endsWith(".lock.json") && ++recordedLocks === 2) controller.abort();
  } }); t.after(() => cancel.close());
  const preview = await f.service.plan(request);
  await assert.rejects(cancel.apply(preview.planId, { signal: controller.signal }), { code: "OPERATION_ABORTED" });
  assert.equal(recordedLocks, 2);
  assert.deepEqual(await readFile(path.join(f.home, "CURRENT")), current);
  for (let i = 0; i < f.files.length; i++) assert.deepEqual(await readFile(`${f.files[i]}.lock.json`), locks[i]);
  const committed = createApplication(f.options, { transactionFault: point => { if (point === "before-cleanup") throw new Error("cleanup unavailable"); } });
  t.after(() => committed.close());
  const result = await committed.execute(request);
  assert.equal(result.outcome, "committed"); assert.equal(result.maintenance, "recovery-required");
  await f.service.recover();
  for (const file of f.files) assert.equal(JSON.parse(await readFile(`${file}.lock.json`, "utf8")).adapterSignatures[0].signature, request.authorizedSignature);
  assert.ok(!(await readdir(f.home)).includes("transaction.json"));
});
