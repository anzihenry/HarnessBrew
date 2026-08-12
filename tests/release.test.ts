import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const releaseCheck = path.resolve("scripts/release-check.mjs");

test("release source metadata is synchronized", async () => {
  const result = await execFileAsync(process.execPath, [releaseCheck, "v0.6.2"], { encoding: "utf8" });

  assert.match(result.stdout, /harnessbrew@0\.6\.2 \(v0\.6\.2\)/);
});

test("release source verification rejects a mismatched tag", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [releaseCheck, "v0.5.2"], { encoding: "utf8" }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /release tag v0\.5\.2 must match v0\.6\.2/);
      return true;
    }
  );
});

test("release workflow publishes an explicit local tarball path", async () => {
  const workflow = await readFile(path.resolve(".github/workflows/release.yml"), "utf8");

  assert.match(workflow, /uses: actions\/checkout@v6/u);
  assert.match(workflow, /uses: actions\/setup-node@v6/u);
  assert.match(workflow, /node-version: 22/u);
  assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v4/u);
  assert.match(workflow, /echo "tarball=\.\/release-artifacts\/\$\{tarball\}"/);
  assert.match(workflow, /npm publish "\$\{\{ steps\.pack\.outputs\.tarball \}\}"/);
});

test("CI uses current Node-based Actions on the supported Node version", async () => {
  const workflow = await readFile(path.resolve(".github/workflows/ci.yml"), "utf8");

  assert.match(workflow, /uses: actions\/checkout@v6/u);
  assert.match(workflow, /uses: actions\/setup-node@v6/u);
  assert.match(workflow, /node-version: 22/u);
  assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v4/u);
});
