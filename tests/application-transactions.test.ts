import assert from "node:assert/strict";
import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { applicationFixture } from "./helpers/application.js";
import { StateStore } from "../src/storage/state-store.js";
import { TransactionCoordinator } from "../src/transactions/coordinator.js";
import { JournalStore } from "../src/transactions/journal.js";

test("metadata publication rolls back after CURRENT and preserves recoverable error evidence", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  const store = new StateStore(f.home), before = await store.read();
  const coordinator = new TransactionCoordinator(f.home, { fault: point => { if (point === "after-state") throw new Error("injected metadata failure"); } });
  await assert.rejects(coordinator.withSession(async session => { const next = await session.read(); next.sources.registrations[0]!.trusted = false; await session.publish(next); }), /injected metadata failure/u);
  assert.deepEqual(await store.read(), before);
  assert.equal((await f.service.doctor()).healthy, true);
});

test("committed orphan cleanup resumes from its quarantined inode after interrupted deletion", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  await f.service.execute({ kind: "asset.install", coordinate: "a", placements: [f.placement] });
  await f.service.execute({ kind: "asset.remove", coordinate: "a" });
  const coordinator = new TransactionCoordinator(f.home, { fault: point => { if (point === "before-cleanup") throw new Error("pause cleanup"); } });
  const result = await coordinator.withSession(async session => { const next = await session.read(); next.install.assets = []; next.contents = []; return session.publish(next); });
  assert.equal(result.diagnostics.length, 1);
  const store = new JournalStore(f.home), journal = (await store.load())!;
  assert.equal(journal.status, "committed"); assert.equal(journal.garbage!.length, 1);
  const entry = journal.garbage![0]!;
  const { rename } = await import("node:fs/promises");
  await rename(entry.path, entry.quarantine);
  await rm(path.join(entry.quarantine, "SKILL.md"));
  await f.service.recover();
  assert.equal((await f.service.doctor()).healthy, true);
  assert.ok(!(await readdir(f.home)).some(name => name.startsWith(".cleanup-")));
  assert.deepEqual((await new StateStore(f.home).read()).install.assets, []);
});

test("committed cleanup preserves externally added quarantine files", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  await f.service.execute({ kind: "asset.install", coordinate: "a" }); await f.service.execute({ kind: "asset.remove", coordinate: "a" });
  const coordinator = new TransactionCoordinator(f.home, { fault: point => { if (point === "before-cleanup") throw new Error("pause cleanup"); } });
  await coordinator.withSession(async session => { const next = await session.read(); next.install.assets = []; next.contents = []; await session.publish(next); });
  const journal = (await new JournalStore(f.home).load())!, entry = journal.garbage![0]!;
  const { rename, writeFile } = await import("node:fs/promises");
  await rename(entry.path, entry.quarantine); const extra = path.join(entry.quarantine, "user-data"); await writeFile(extra, "keep me");
  await assert.rejects(f.service.recover(), { code: "RECOVERY_CONFLICT" });
  assert.equal(await readFile(extra, "utf8"), "keep me");
  await assert.rejects(f.service.query({ kind: "list" }), { code: "RECOVERY_REQUIRED" });
});

test("metadata failure plus damaged journal retains both errors", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  const { writeFile } = await import("node:fs/promises");
  const coordinator = new TransactionCoordinator(f.home, { fault: async point => {
    if (point === "prepared") { await writeFile(path.join(f.home, "transaction.json"), "damaged"); throw new Error("original metadata failure"); }
  } });
  await assert.rejects(coordinator.withSession(async session => { const next = await session.read(); next.sources.registrations[0]!.trusted = false; await session.publish(next); }), error => {
    assert.equal((error as { code: string }).code, "RECOVERY_REQUIRED");
    const cause = (error as Error).cause; assert.ok(cause instanceof AggregateError); assert.match(cause.errors[0].message, /original metadata failure/u); assert.equal(cause.errors[1].code, "RECOVERY_REQUIRED"); return true;
  });
  assert.equal(await readFile(path.join(f.home, "transaction.json"), "utf8"), "damaged");
});
