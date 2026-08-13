import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertPathMissing, assertSuccessfulEnvelope, readJsonFile } from "../assertions.mjs";
import { createTapFixture } from "../fixture-tap.mjs";

function homeOptions(home, cwd) {
  return { cwd, env: { HARNESSBREW_HOME: home } };
}

function manifest(remote, includeAssets = true) {
  return `schemaVersion: 2
taps:
  - name: e2e/assets
    git: ${JSON.stringify(remote)}
    trust: true
assets:
${includeAssets ? `  - formula: e2e/assets/main-skill
    targets:
      - target: openai-codex
        scope: user
        root: ./codex-user
      - target: claude-code
        scope: project
        project: ./project
` : "  []\n"}`;
}

export async function bundleReproductionScenario({ environment, cli }) {
  const fixture = await createTapFixture(environment, { id: "bundle-reproduction" });
  const firstRoot = path.join(environment.root, "bundle-machine-one");
  const secondRoot = path.join(environment.root, "bundle-machine-two");
  const firstHome = path.join(firstRoot, "harnessbrew-home");
  const secondHome = path.join(secondRoot, "harnessbrew-home");
  const firstFile = path.join(firstRoot, "Harnessfile");
  const secondFile = path.join(secondRoot, "Harnessfile");
  const secondLock = `${secondFile}.lock`;
  await Promise.all([mkdir(firstRoot, { recursive: true }), mkdir(secondRoot, { recursive: true })]);
  await writeFile(firstFile, manifest(fixture.remote), "utf8");
  await writeFile(secondFile, manifest(fixture.remote), "utf8");

  const first = await cli.runJson(["bundle", "install", "--file", firstFile], homeOptions(firstHome, firstRoot));
  assertSuccessfulEnvelope(first.envelope, "bundle");
  const firstLock = await readJsonFile(`${firstFile}.lock`);
  assert.equal(firstLock.schemaVersion, 2);
  assert.equal(firstLock.taps[0].commit, fixture.v1Commit);
  assert.ok(firstLock.assets.every((asset) => asset.commit === fixture.v1Commit));

  await fixture.pushV2();
  await copyFile(`${firstFile}.lock`, secondLock);
  const reproduced = await cli.runJson(["bundle", "install", "--file", secondFile], homeOptions(secondHome, secondRoot));
  assertSuccessfulEnvelope(reproduced.envelope, "bundle");
  const mainReceipt = await readJsonFile(path.join(secondHome, "receipts", "e2e", "assets", "main-skill.json"));
  assert.equal(mainReceipt.commit, fixture.v1Commit);
  assert.match(await readFile(path.join(mainReceipt.cellarPath, "SKILL.md"), "utf8"), /v1/u);
  assert.equal(mainReceipt.operations.length, 2);
  assert.match(
    await readFile(path.join(secondRoot, "codex-user", "skills", "main-skill", "references", "version.txt"), "utf8"),
    /v1/u
  );
  assert.match(
    await readFile(path.join(secondRoot, "project", ".claude", "skills", "main-skill", "references", "version.txt"), "utf8"),
    /v1/u
  );

  const extra = await cli.runJson(["install", "runtime-agent"], homeOptions(secondHome, secondRoot));
  assertSuccessfulEnvelope(extra.envelope, "install");
  assert.ok((await cli.runJson(["list"], homeOptions(secondHome, secondRoot))).envelope.result
    .some((receipt) => receipt.coordinate === "e2e/assets/runtime-agent"));
  const converged = await cli.runJson(["bundle", "cleanup", "--file", secondFile], homeOptions(secondHome, secondRoot));
  assertSuccessfulEnvelope(converged.envelope, "bundle");
  assert.deepEqual(converged.envelope.result.removed, ["e2e/assets/runtime-agent"]);

  await writeFile(secondFile, manifest(fixture.remote, false), "utf8");
  const cleaned = await cli.runJson(["bundle", "cleanup", "--file", secondFile], homeOptions(secondHome, secondRoot));
  assertSuccessfulEnvelope(cleaned.envelope, "bundle");
  assert.deepEqual(new Set(cleaned.envelope.result.removed), new Set([
    "e2e/assets/helper-skill",
    "e2e/assets/main-skill"
  ]));
  assert.deepEqual((await cli.runJson(["list"], homeOptions(secondHome, secondRoot))).envelope.result, []);
  await assertPathMissing(path.join(secondRoot, "codex-user", "skills", "main-skill"));
  await assertPathMissing(path.join(secondRoot, "project", ".claude", "skills", "main-skill"));

  return { tap: fixture.name, pinnedCommit: fixture.v1Commit, latestCommit: fixture.v2Commit };
}
