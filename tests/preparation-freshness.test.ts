import assert from "node:assert/strict";
import { cp, mkdir, readFile, rename, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { applicationFixture } from "./helpers/application.js";
import { createApplication } from "../src/application/service.js";
import { StateStore } from "../src/storage/state-store.js";
import { JournalStore } from "../src/transactions/journal.js";
import { TransactionCoordinator } from "../src/transactions/coordinator.js";
import { exists } from "../src/execution/files.js";

for (const change of ["trust", "home", "target", "source"] as const) test(`execute refuses ${change} changes after preparation without partial writes`, async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  const store = new StateStore(f.home), before = await store.read();
  let calls = 0;
  const service = createApplication(f.options, { preparationCheckpoint: async () => {
    calls++;
    if (change === "trust") await f.service.execute({ kind: "tap.untrust", name: "test/assets" });
    if (change === "home") { await rename(f.home, `${f.home}-original`); await cp(`${f.home}-original`, f.home, { recursive: true }); }
    if (change === "target") { await mkdir(path.join(f.project, ".agents", "skills"), { recursive: true }); await writeFile(path.join(f.project, ".agents", "skills", "a"), "user content"); }
    if (change === "source") await writeFile(path.join(before.sources.snapshots[0]!.contentLocation, "assets", "a", "SKILL.md"), "tampered");
  } });
  try { await assert.rejects(service.execute({ kind: "asset.install", coordinate: "a", placements: [f.placement] }), error => ["PLAN_STALE", "CONTENT_MODIFIED"].includes((error as { code: string }).code)); }
  finally { await service.close(); }
  assert.equal(calls, 1);
  assert.equal((await store.read()).install.assets.length, 0);
  assert.equal(await exists(path.join(f.home, "transaction.json")), false);
  if (change === "target") assert.equal(await readFile(path.join(f.project, ".agents", "skills", "a"), "utf8"), "user content");
});

test("aliases share the same plan cache and physical Home", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  const alias = path.join(f.root, "alias"); await symlink(f.root, alias, "dir");
  const service = createApplication({ ...f.options, home: path.join(alias, "home") });
  try {
    const preview = await service.plan({ kind: "asset.install", coordinate: "a", placements: [f.placement] });
    await f.service.apply(preview.planId);
    assert.equal((await service.doctor()).healthy, true);
  } finally { await service.close(); }
});

test("execute recovers before preparing; a later committed journal makes the prepared revision stale", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  const state = await new StateStore(f.home).read(), journal = new JournalStore(f.home);
  await journal.save({ format: "harnessbrew.journal", version: 1, id: "pending", home: f.home, status: "prepared", beforeState: state, nextRevision: "next", steps: [] });
  await assert.rejects(f.service.plan({ kind: "tap.untrust", name: "test/assets" }), { code: "RECOVERY_REQUIRED" });
  await f.service.execute({ kind: "tap.untrust", name: "test/assets" });
  assert.equal(await journal.load(), undefined);
  await f.service.execute({ kind: "tap.trust", name: "test/assets" });
  const service = createApplication(f.options, { preparationCheckpoint: async () => {
    const coordinator = new TransactionCoordinator(f.home, { fault: point => { if (point === "before-cleanup") throw new Error("pending cleanup"); } });
    await coordinator.withSession(async session => { const next = await session.read(); next.sources.registrations[0]!.trusted = false; return session.publish(next); });
    assert.equal((await journal.load())!.status, "committed");
  } });
  try { await assert.rejects(service.execute({ kind: "asset.install", coordinate: "a" }), { code: "PLAN_STALE" }); }
  finally { await service.close(); }
  assert.equal(await journal.load(), undefined);
  assert.equal((await f.service.query({ kind: "list" })).assets.length, 0);
});

test("first saved plan does not adopt a competing initialization change", async t => {
  const f = await applicationFixture(t); await f.add("a");
  const preview = await f.service.plan({ kind: "tap.add", name: "test/assets", url: f.repository });
  const competing = createApplication(f.options, { preparationCheckpoint: async () => {
    await f.service.execute({ kind: "tap.add", name: "other/assets", url: f.repository });
  } });
  try { await assert.rejects(competing.apply(preview.planId), { code: "PLAN_STALE" }); }
  finally { await competing.close(); }
  assert.deepEqual((await f.service.query({ kind: "taps" })).map(t => t.name), ["other/assets"]);
});
