import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { runCli } from "../src/cli.js";
import { withFileLock, withHomeLock } from "../src/core/locks.js";

const execFileAsync = promisify(execFile);

test("file locks serialize independent processes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-lock-"));
  const lockPath = path.join(root, "shared.lock");
  const tracePath = path.join(root, "trace.txt");
  const moduleUrl = new URL("../src/core/locks.js", import.meta.url).href;
  const script = `
    import { appendFile } from "node:fs/promises";
    import { withFileLock } from ${JSON.stringify(moduleUrl)};
    const [lockPath, tracePath, name, hold] = process.argv.slice(1);
    await withFileLock(lockPath, async () => {
      await appendFile(tracePath, name + ":start\\n");
      await new Promise((resolve) => setTimeout(resolve, Number(hold)));
      await appendFile(tracePath, name + ":end\\n");
    });
  `;
  const first = execFileAsync(process.execPath, ["--input-type=module", "-e", script, lockPath, tracePath, "first", "300"]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const second = execFileAsync(process.execPath, ["--input-type=module", "-e", script, lockPath, tracePath, "second", "0"]);
  await Promise.all([first, second]);
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
