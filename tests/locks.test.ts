import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { withFileLock } from "../src/transactions/file-lock.js";

test("file locks serialize independent processes", { timeout: 10_000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-lock-"));
  const lockPath = path.join(root, "shared.lock");
  const tracePath = path.join(root, "trace.txt");
  const spawn = (name: string) => fork(new URL("./helpers/lock-child.js", import.meta.url), [lockPath, tracePath, name], {
    stdio: ["ignore", "ignore", "pipe", "ipc"]
  });
  const first = spawn("first");
  t.after(() => { first.kill(); });
  const firstExit = once(first, "exit");
  const firstReady = await Promise.race([
    once(first, "message"), firstExit.then(() => { throw new Error("first process exited before ready"); })
  ]);
  assert.equal(firstReady[0], "acquired");
  const second = spawn("second");
  t.after(() => { second.kill(); });
  const secondExit = once(second, "exit");
  const blocked = await Promise.race([
    once(second, "message"), secondExit.then(() => { throw new Error("second process exited before lock contention"); })
  ]);
  assert.equal(blocked[0], "blocked");
  const secondReady = once(second, "message");
  first.send("release");
  assert.equal((await firstExit)[0], 0);
  assert.equal((await secondReady)[0], "acquired");
  second.send("release");
  assert.equal((await secondExit)[0], 0);
  assert.deepEqual((await readFile(tracePath, "utf8")).trim().split("\n"), [
    "first:start", "first:end", "second:start", "second:end"
  ]);
});

test("file locks time out and release after failures", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-lock-"));
  const lockPath = path.join(root, "shared.lock");
  await withFileLock(lockPath, async () => {
    await assert.rejects(
      withFileLock(lockPath, async () => undefined, { timeoutMs: 30, retryMs: 5 }),
      /Timed out waiting for lock/
    );
  });
  await assert.rejects(withFileLock(lockPath, async () => { throw new Error("failure"); }), /failure/);
  assert.equal(await withFileLock(lockPath, async () => "released"), "released");
});

for (const checkpoint of ["directory-ready", "choosing-published", "ticket-staged", "ticket-published", "acquired", "released"]) {
  test(`lock resumes after SIGKILL at ${checkpoint}`, { timeout: 10000 }, async t => {
    const { readdir, rm } = await import("node:fs/promises");
    const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-lock-crash-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const lock = path.join(root, "shared.lock");
    const child = fork(new URL("./helpers/lock-protocol-child.js", import.meta.url), [lock, checkpoint], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
    t.after(() => { child.kill("SIGKILL"); });
    const exit = once(child, "exit");
    const ready = await Promise.race([once(child, "message"), exit.then(() => { throw new Error("Child exited before checkpoint"); })]);
    assert.equal(ready[0], checkpoint);
    child.kill("SIGKILL"); await exit;
    assert.equal(await withFileLock(lock, async () => "recovered", { timeoutMs: 1000, retryMs: 2 }), "recovered");
    assert.deepEqual(await readdir(lock), []);
  });
}

test("simultaneous choosing and repeated contention never overlap or lose updates", { timeout: 15000 }, async t => {
  const { rm, writeFile } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-lock-burst-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lock = path.join(root, "shared.lock"), counter = path.join(root, "counter");
  await writeFile(counter, "0");
  const children = Array.from({ length: 5 }, () => fork(new URL("./helpers/lock-protocol-child.js", import.meta.url), [lock, "contend", counter], { stdio: ["ignore", "ignore", "pipe", "ipc"] }));
  t.after(() => { for (const child of children) child.kill("SIGKILL"); });
  const exits = children.map(child => once(child, "exit"));
  await Promise.all(children.map((child, i) => Promise.race([once(child, "message").then(([message]) => assert.equal(message, "ready")), exits[i]!.then(() => { throw new Error("Child exited before barrier"); })])));
  for (const child of children) child.send("go");
  for (const exit of await Promise.all(exits)) assert.equal(exit[0], 0);
  assert.equal(await readFile(counter, "utf8"), "40");
  const trace = (await readFile(`${counter}.trace`, "utf8")).trim().split("\n");
  assert.equal(trace.length, 80);
  for (let i = 0; i < trace.length; i += 2) assert.equal(trace[i + 1], trace[i]!.replace(":start", ":end"));
});

test("empty lock namespaces and abandoned reclaim directories do not block; corrupt records fail closed", async t => {
  const { randomUUID } = await import("node:crypto");
  const { mkdir, rm, writeFile } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-lock-empty-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lock = path.join(root, "shared.lock");
  await mkdir(lock); await mkdir(`${lock}.reclaim`);
  assert.equal(await withFileLock(lock, async () => "ok"), "ok");
  const file = path.join(lock, `${process.pid}-${randomUUID()}.json`);
  await writeFile(file, "partial metadata");
  await assert.rejects(withFileLock(lock, async () => assert.fail("must not enter")), { code: "LOCK_CORRUPT" });
  assert.equal(await readFile(file, "utf8"), "partial metadata");
});

test("a live participant choosing a ticket cannot be reclaimed by timeout", async t => {
  const { rm, readdir } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-lock-choosing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const lock = path.join(root, "shared.lock");
  await withFileLock(lock, async () => {}, { fault: async point => {
    if (point !== "choosing-published") return;
    await assert.rejects(withFileLock(lock, async () => assert.fail("live choosing owner must block"), { timeoutMs: 20, retryMs: 2 }), { code: "LOCK_TIMEOUT" });
    assert.equal((await readdir(lock)).length, 1);
  } });
  assert.deepEqual(await readdir(lock), []);
});
