import assert from "node:assert/strict";
import { readFile, readdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createApplication } from "../src/application/service.js";
import { JournalStore } from "../src/transactions/journal.js";
import { StateStore } from "../src/storage/state-store.js";
import { PLAN_LIFETIME_MS } from "../src/application/retention.js";
import { stableId } from "../src/domain/identity.js";
import { applicationFixture } from "./helpers/application.js";
const limits = { ttlMs: 0, keepNewest: 0, maxBytes: 0 };
test("CURRENT and a valid saved plan base survive revision retention; pending Home journal blocks GC", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  const plan = await f.service.plan({ kind: "asset.install", coordinate: "a" });
  await f.service.execute({ kind: "tap.untrust", name: "test/assets" });
  const state = await new StateStore(f.home).read(), preview = await f.service.planMaintenance(limits);
  const baseFile = path.join(f.home, "revisions", `${plan.baseRevision}.json`);
  assert.ok(preview.objects.find(o => o.path === baseFile)?.reasons.includes("valid-plan-base-revision"));
  assert.ok(preview.objects.find(o => o.path.endsWith(`${state.revision}.json`))?.reasons.includes("current-state"));
  const journal = new JournalStore(f.home);
  await journal.save({ format: "harnessbrew.journal", version: 1, id: "pending", home: f.home, status: "prepared", beforeState: state, nextRevision: "pending-next", steps: [] });
  await assert.rejects(f.service.planMaintenance(limits), { code: "RECOVERY_REQUIRED" });
  await assert.rejects(f.service.applyMaintenance(preview.planId), { code: "RECOVERY_REQUIRED" });
  assert.ok(await readFile(baseFile, "utf8")); await journal.clear();
  await f.service.applyMaintenance(preview.planId);
  assert.ok(await readFile(baseFile, "utf8")); assert.equal((await new StateStore(f.home).read()).revision, state.revision);
});
test("repeated install/upgrade/maintenance bounds collectible revisions and prepared objects without deleting user quarantine", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  await f.service.execute({ kind: "asset.install", coordinate: "a", placements: [f.placement] });
  const cache = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`);
  const original = (await f.service.query({ kind: "list" })).contents[0]!;
  await writeFile(path.join(f.home, "content", original.digest.slice(7), "SKILL.md"), "user edited content");
  await f.service.execute({ kind: "repair", coordinate: "a", restoreContent: true });
  const quarantine = (await f.service.query({ kind: "list" })).quarantines[0]!.path;
  const old = new Date(Date.now() - PLAN_LIFETIME_MS - 1000);
  for (let i = 0; i < 5; i++) {
    await f.add("a", {}, `---\nname: a\ndescription: test\n---\n# revision ${i}\n`);
    await f.service.execute({ kind: "tap.update", name: "test/assets" });
    await f.service.execute({ kind: "asset.upgrade", coordinate: "a" });
    for (const name of await readdir(path.join(cache, "maintenance")).catch(() => [] as string[])) if (name.endsWith(".json")) await utimes(path.join(cache, "maintenance", name), old, old);
    const preview = await f.service.planMaintenance({ ...limits, keepNewest: 2 });
    assert.ok(preview.overBudgetBytes > 0);
    await f.service.applyMaintenance(preview.planId);
    assert.ok((await readdir(path.join(f.home, "revisions"))).filter(n => n.endsWith(".json")).length <= 3);
    assert.ok((await readdir(path.join(cache, "prepared"))).length <= 2);
    assert.ok((await readdir(path.join(cache, "maintenance"))).filter(n => n.endsWith(".json")).length <= 3);
    assert.equal(await readFile(path.join(quarantine, "SKILL.md"), "utf8"), "user edited content");
    assert.ok((await f.service.doctor()).healthy);
  }
});

test("revision quarantine stays inside Home and resumes without changing CURRENT", async t => {
  const f = await applicationFixture(t); await f.register();
  const current = await readFile(path.join(f.home, "CURRENT"), "utf8"), preview = await f.service.planMaintenance(limits);
  const service = createApplication(f.options, { maintenanceFault: (point, file) => {
    if (point === "quarantined" && file?.startsWith(path.join(f.home, "revisions"))) throw new Error("interrupted revision quarantine");
  } });
  t.after(() => service.close());
  await assert.rejects(service.applyMaintenance(preview.planId), { code: "RECOVERY_REQUIRED" });
  assert.ok((await readdir(path.join(f.home, "revisions"))).some(n => n.startsWith(".maintenance-")));
  assert.equal((await f.service.recoverMaintenance())?.recovered, true);
  assert.equal(await readFile(path.join(f.home, "CURRENT"), "utf8"), current);
  assert.ok(!(await readdir(path.join(f.home, "revisions"))).some(n => n.startsWith(".maintenance-")));
});
