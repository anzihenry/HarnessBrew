import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { nodeStorageIO } from "../src/ports/io.js";
import { StateStore } from "../src/storage/state-store.js";
import { fixtureState } from "./helpers/domain.js";

async function setup(t: TestContext): Promise<StateStore> {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-state-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return new StateStore(path.join(root, "home"));
}
function candidate(revision: string) {
  const value = fixtureState(true);
  value.revision = revision;
  value.install.revision = revision;
  return value;
}
test("state atomically publishes sources, authorizations, owners and operations together", async t => {
  const store = await setup(t);
  const initial = await store.initialize();
  const saved = await store.commit(initial.revision, candidate(initial.revision));
  assert.notEqual(saved.revision, initial.revision);
  assert.deepEqual(await new StateStore(store.home).read(), saved);
  assert.equal(saved.install.revision, saved.revision);
  assert.equal((await store.commit(saved.revision, saved)).revision, saved.revision);
  saved.install.assets.length = 0;
  assert.equal((await store.read()).install.assets.length, 2);
});
test("legacy data and unknown CURRENT formats are not overwritten", async t => {
  const store = await setup(t);
  await nodeStorageIO.mkdir(store.home);
  const old = '{"schemaVersion":1,"taps":{}}\n';
  await writeFile(path.join(store.home, "state.json"), old);
  await assert.rejects(store.initialize(), { code: "UNSUPPORTED_FORMAT" });
  assert.equal(await readFile(path.join(store.home, "state.json"), "utf8"), old);
  assert.deepEqual((await readdir(store.home)).filter(name => name !== ".store.lock"), ["state.json"]);
  assert.deepEqual(await readdir(path.join(store.home, ".store.lock")), []);
  await writeFile(path.join(store.home, "CURRENT"), JSON.stringify({ format: "harnessbrew.current", version: 42 }));
  await assert.rejects(store.initialize(), { code: "UNSUPPORTED_FORMAT" });
});
test("invalid candidates and stale writers cannot replace the published revision", async t => {
  const store = await setup(t);
  const initial = await store.initialize();
  const bad = candidate(initial.revision);
  bad.install.assets.pop();
  await assert.rejects(store.commit(initial.revision, bad), { code: "DEPENDENCY_MISSING" });
  assert.equal((await store.read()).revision, initial.revision);
  const results = await Promise.allSettled([
    store.commit(initial.revision, candidate(initial.revision)),
    new StateStore(store.home).commit(initial.revision, candidate(initial.revision))
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const failure = results.find(result => result.status === "rejected");
  assert.ok(failure?.status === "rejected");
  assert.equal(failure.reason.code, "PLAN_STALE");
});
test("I/O and prepublication checkpoint failures leave the old complete snapshot readable", async t => {
  const store = await setup(t);
  const initial = await store.initialize();
  for (const checkpoint of ["revision-durable", "before-publish"] as const) {
    const failing = new StateStore(store.home, { fault(point) { if (point === checkpoint) throw new Error(point); } });
    await assert.rejects(failing.commit(initial.revision, candidate(initial.revision)), new RegExp(checkpoint));
    assert.deepEqual(await store.read(), initial);
  }
  const failingIO = new StateStore(store.home, { io: { ...nodeStorageIO, async rename() { throw new Error("disk failure"); } } });
  await assert.rejects(failingIO.commit(initial.revision, candidate(initial.revision)), /disk failure/u);
  assert.deepEqual(await store.read(), initial);
  assert.equal((await readdir(store.home)).some(name => name.endsWith(".tmp")), false);
});
test("checksum corruption, pointer traversal and symbolic state files fail closed", async t => {
  const store = await setup(t);
  const initial = await store.initialize();
  const file = path.join(store.home, "revisions", `${initial.revision}.json`);
  const original = await readFile(file, "utf8");
  await writeFile(file, '{}\n');
  await assert.rejects(store.read(), { code: "STATE_CORRUPT" });
  await writeFile(file, original);
  const outside = path.join(path.dirname(store.home), "outside.json");
  await writeFile(outside, original);
  await rm(file);
  await symlink(outside, file);
  await assert.rejects(store.read(), { code: "STATE_CORRUPT" });
  const pointer = JSON.parse(await readFile(path.join(store.home, "CURRENT"), "utf8"));
  pointer.revision = "../outside";
  await writeFile(path.join(store.home, "CURRENT"), JSON.stringify(pointer));
  await assert.rejects(store.read(), { code: "INVALID_STATE" });
  assert.equal(await readFile(outside, "utf8"), original);
});
test("a process killed after snapshot persistence cannot publish a partial Home state", async t => {
  const store = await setup(t);
  const initial = await store.initialize();
  const child = fork(new URL("./helpers/store-crash-child.js", import.meta.url), [store.home], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); });
  const ready = await Promise.race([
    once(child, "message"),
    once(child, "exit").then(() => { throw new Error("State writer exited before checkpoint"); })
  ]);
  assert.equal(ready[0], "revision-durable");
  const exited = once(child, "exit");
  child.kill("SIGKILL");
  await exited;
  assert.deepEqual(await store.read(), initial);
  // The next writer reclaims the dead process lock and can publish a new revision.
  const saved = await store.commit(initial.revision, candidate(initial.revision));
  assert.equal(saved.install.assets.length, 2);
});

test("canonical ordering is a no-op and caller mutation cannot change a queued commit", async t => {
  const store = await setup(t);
  const initial = await store.initialize();
  const saved = await store.commit(initial.revision, candidate(initial.revision));
  const reordered = structuredClone(saved);
  reordered.install.assets.reverse();
  reordered.install.operations.reverse();
  reordered.install.requirements[0]!.resolvedAssets.reverse();
  assert.equal((await store.commit(saved.revision, reordered)).revision, saved.revision);
  const next = structuredClone(saved);
  next.sources.registrations[0]!.trusted = false;
  const pending = store.commit(saved.revision, next);
  next.sources.registrations[0]!.trusted = true;
  assert.equal((await pending).sources.registrations[0]?.trusted, false);
});

test("postpublication sync errors explicitly report uncertain durability and retain the new state", async t => {
  const store = await setup(t);
  const initial = await store.initialize();
  const failing = new StateStore(store.home, { io: { ...nodeStorageIO, async syncDirectory(directory) {
    if (directory === store.home) throw new Error("sync failed");
    return nodeStorageIO.syncDirectory(directory);
  } } });
  await assert.rejects(failing.commit(initial.revision, candidate(initial.revision)), { code: "RECOVERY_REQUIRED" });
  const observed = await store.read();
  assert.notEqual(observed.revision, initial.revision);
  assert.equal(observed.install.assets.length, 2);
});
