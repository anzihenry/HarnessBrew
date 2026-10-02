import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "./helpers/legacy-cli.js";
import { withFileLock, withHomeLock } from "../src/core/locks.js";

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

test("mutating CLI commands wait for the HarnessBrew home lock", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "harnessbrew-home-lock-"));
  let settled = false;
  let command: Promise<number> | undefined;
  await withHomeLock(home, async () => {
    command = runCli(["untap", "missing/tap"], { stdout: () => undefined, stderr: () => undefined }, { home })
      .then((exitCode) => {
        settled = true;
        return exitCode;
      });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(settled, false);
  });
  assert.equal(await command, 1);
});
