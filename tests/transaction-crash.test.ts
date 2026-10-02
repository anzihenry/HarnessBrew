import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { lstat, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fixture, build, A } from "./helpers/execution.js";
import { TransactionCoordinator } from "../src/transactions/coordinator.js";
import { JournalStore } from "../src/transactions/journal.js";
import { StateStore } from "../src/storage/state-store.js";
import { withFileLock } from "../src/transactions/file-lock.js";

for (const [checkpoint, suffix, outcome] of [
  ["prepared", "", "rollback"], ["after-record", "/skills/a", "rollback"],
  ["after-state", "", "rollback"], ["after-write", "/skills/a", "conflict"], ["committed", "", "committed"]
] as const) test(`SIGKILL at ${checkpoint} produces ${outcome} after restart`, { timeout: 20000 }, async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const child = fork(new URL("./helpers/execution-child.js", import.meta.url), [f.root, checkpoint, suffix], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  const ready = await once(child, "message"); assert.equal((ready[0] as { checkpoint: string }).checkpoint, checkpoint);
  const exit = once(child, "exit"); child.kill("SIGKILL"); await exit;
  const coordinator = new TransactionCoordinator(f.home, { lockRoot: f.lockRoot });
  if (outcome === "conflict") {
    await assert.rejects(coordinator.recover(), { code: "RECOVERY_REQUIRED" });
    assert.ok((await lstat(path.join(f.project, ".agents/skills/a"))).isSymbolicLink());
    assert.equal((await new JournalStore(f.home).load())?.status, "recovery-required");
  } else {
    await coordinator.recover(); const state = await coordinator.read();
    assert.equal(await new JournalStore(f.home).load(), undefined);
    if (outcome === "rollback") { assert.deepEqual(state, f.state); await assert.rejects(lstat(path.join(f.project, ".agents/skills/a")), { code: "ENOENT" }); }
    else { assert.equal(state.install.assets.length, 1); assert.ok((await lstat(path.join(f.project, ".agents/skills/a"))).isSymbolicLink()); }
  }
});

test("a held transaction excludes another Home from the shared external lock", { timeout: 20000 }, async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const child = fork(new URL("./helpers/execution-child.js", import.meta.url), [f.root, "prepared"], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  await once(child, "message");
  await assert.rejects(withFileLock(path.join(f.lockRoot, "external.lock"), async () => undefined, { timeoutMs: 50, retryMs: 5 }), /Timed out/);
  const done = once(child, "exit"); child.send("continue"); await done;
  await withFileLock(path.join(f.lockRoot, "external.lock"), async () => undefined, { timeoutMs: 100 });
});

test("two Homes preserve each other's keys in a shared config", async t => {
  const f = await fixture("mcp", 2); t.after(() => rm(f.root, { recursive: true, force: true }));
  const otherHome = path.join(f.root, "second-home"), otherStore = new StateStore(otherHome);
  const empty = await otherStore.initialize();
  await otherStore.commit(empty.revision, { ...f.state, revision: empty.revision, install: { ...f.state.install, revision: empty.revision } });
  // Use independent roots; the fixture's A dependency is removed before either plan is made.
  f.catalog.assets[0]!.manifest.dependencies = [];
  const one = new TransactionCoordinator(f.home, { lockRoot: f.lockRoot }), two = new TransactionCoordinator(otherHome, { lockRoot: f.lockRoot });
  const placements = [{ target: "openai-codex", scope: "project" as const, projectRoot: f.project }];
  await Promise.all([
    one.execute(state => build(f.home, state, f.catalog, { kind: "asset.install", coordinate: A, placements })),
    two.execute(state => build(otherHome, state, f.catalog, { kind: "asset.install", coordinate: "test/assets/b", placements }))
  ]);
  const content = await readFile(path.join(f.project, ".codex/config.toml"), "utf8");
  assert.ok(content.includes('"a"')); assert.ok(content.includes('"b"'));
  await one.execute(state => build(f.home, state, f.catalog, { kind: "asset.remove", coordinate: A }));
  const retained = await readFile(path.join(f.project, ".codex/config.toml"), "utf8"); assert.ok(retained.includes('"b"')); assert.ok(!retained.includes('"a"'));
});
