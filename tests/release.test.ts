import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const releaseCheck = path.resolve("scripts/release-check.mjs");

test("dependency downloads use the public npm registry", async () => {
  const lock = JSON.parse(await readFile("package-lock.json", "utf8")) as {
    packages: Record<string, { resolved?: string; integrity?: string }>;
  };
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (name === "") continue;
    assert.ok(entry.resolved, `${name} must pin a download URL`);
    assert.equal(new URL(entry.resolved).origin, "https://registry.npmjs.org", name);
    assert.match(entry.integrity ?? "", /^sha512-/u, `${name} must retain integrity verification`);
  }
  const npmrc = await readFile(".npmrc", "utf8");
  assert.match(npmrc, /^registry=https:\/\/registry\.npmjs\.org\/$/mu);
});

test("release source metadata is synchronized", async () => {
  const result = await execFileAsync(process.execPath, [releaseCheck, "v0.7.1"], { encoding: "utf8" });

  assert.match(result.stdout, /harnessbrew@0\.7\.1 \(v0\.7\.1\)/);
});

test("release source verification rejects a mismatched tag", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [releaseCheck, "v0.6.2"], { encoding: "utf8" }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /release tag v0\.6\.2 must match v0\.7\.1/);
      return true;
    }
  );
});

test("release workflow publishes the approved candidate without rebuilding", async () => {
  const workflow = await readFile(path.resolve(".github/workflows/release.yml"), "utf8");

  assert.match(workflow, /uses: actions\/checkout@v6/u);
  assert.match(workflow, /uses: actions\/setup-node@v6/u);
  assert.match(workflow, /node-version: 22/u);
  assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v4/u);
  assert.match(workflow, /environment: npm-production/u);
  assert.match(workflow, /candidate-run-id:/u);
  assert.match(workflow, /run-id: \$\{\{ inputs\['candidate-run-id'\] \}\}/u);
  assert.match(workflow, /--expected-commit "\$commit"/u);
  assert.match(workflow, /--expected-tag "\$\{\{ inputs\.tag \}\}"/u);
  assert.match(workflow, /find "\$\{GITHUB_WORKSPACE:\?\}\/release-artifacts"/u);
  assert.match(workflow, /npm publish "\$\{\{ steps\.identity\.outputs\.package \}\}"/u);
  assert.match(workflow, /scripts\/registry-smoke\.mjs/u);
  assert.doesNotMatch(workflow, /npm (?:pack|run build|run check)/u);
});

test("CI pins release tooling and checks the supported Node and npm matrix", async () => {
  const workflow = await readFile(path.resolve(".github/workflows/ci.yml"), "utf8");

  assert.match(workflow, /uses: actions\/checkout@v6/u);
  assert.match(workflow, /uses: actions\/setup-node@v6/u);
  assert.match(workflow, /node-version: 22/u);
  assert.match(workflow, /node: 24\n\s+npm: 12\.0\.2/u);
  assert.match(workflow, /npm install --global npm@\$\{\{ matrix\.npm \}\}/u);
  assert.match(workflow, /npm install --global npm@11\.17\.0/u);
  assert.doesNotMatch(workflow, /actions\/(?:checkout|setup-node)@v4/u);
  assert.match(workflow, /name: release-candidate/u);
  assert.match(workflow, /matrix:\n\s+os: \[ubuntu-latest, macos-latest\]/u);
  assert.match(workflow, /npm run artifact:build/u);
  assert.match(workflow, /npm run release:gate/u);
  assert.match(workflow, /needs\.candidate\.outputs\.sha256/u);
  assert.doesNotMatch(workflow, /node -p \\"/u);
  assert.doesNotMatch(workflow, /\b(?:codex|claude)\b/iu);
});

test("release candidate workflow builds once and retains cross-platform evidence", async () => {
  const workflow = await readFile(path.resolve(".github/workflows/release-candidate.yml"), "utf8");

  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /ref: \$\{\{ inputs\.ref \}\}/u);
  assert.equal((workflow.match(/npm run artifact:build/gu) ?? []).length, 1);
  assert.match(workflow, /matrix:\n\s+os: \[ubuntu-latest, macos-latest\]/u);
  assert.match(workflow, /npm run release:gate/u);
  assert.equal((workflow.match(/npm install --global npm@11\.17\.0/gu) ?? []).length, 2);
  assert.match(workflow, /release-candidate-\$\{\{ github\.run_id \}\}/u);
  assert.match(workflow, /release-gate-\$\{\{ github\.run_id \}\}-\$\{\{ runner\.os \}\}/u);
  assert.match(workflow, /retention-days: 30/u);
  assert.doesNotMatch(workflow, /node -p \\"/u);
  assert.doesNotMatch(workflow, /\b(?:codex|claude)\b/iu);
});
