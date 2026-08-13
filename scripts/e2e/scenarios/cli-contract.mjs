import assert from "node:assert/strict";
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { assertFailedEnvelope, assertPathMissing, assertSuccessfulEnvelope, pathExists } from "../assertions.mjs";
import { createTapFixture } from "../fixture-tap.mjs";

export async function cliContractScenario({ environment, cli }) {
  const fixture = await createTapFixture(environment, { id: "cli-contract" });
  const home = path.join(environment.root, "cli-contract-home");
  const project = path.join(environment.root, "cli-contract-project");
  const targetRoot = path.join(environment.root, "cli-contract-codex");
  const options = { cwd: project, env: { HARNESSBREW_HOME: home } };
  await mkdir(project, { recursive: true });

  const version = await cli.runJson(["version"], options);
  assertSuccessfulEnvelope(version.envelope, "version");
  assert.equal(version.envelope.result.version, environment.artifact.package.version);
  assert.equal(version.stdout.trim().split("\n").length, 1);

  const unknown = await cli.runJson(["missing-command"], { ...options, expectExitCode: 1 });
  assertFailedEnvelope(unknown.envelope, "missing-command", /Unknown command/u);
  assert.equal(unknown.envelope.error.code, "COMMAND_FAILED");
  assert.deepEqual(unknown.envelope.result, null);
  assert.equal(unknown.stderr, "");

  const domainFailure = await cli.runJson(["tap", "remove", "missing/tap"], { ...options, expectExitCode: 1 });
  assertFailedEnvelope(domainFailure.envelope, "tap", /Tap not found/u);
  assert.equal(domainFailure.envelope.error.code, "HARNESSBREW_ERROR");
  const invalidDryRun = await cli.runJson(["search", "skill", "--dry-run"], { ...options, expectExitCode: 1 });
  assertFailedEnvelope(invalidDryRun.envelope, "search", /requires a mutating command/u);

  assertSuccessfulEnvelope((await cli.runJson([
    "tap", "add", fixture.name, fixture.remote, "--trust"
  ], options)).envelope, "tap");
  const targetPath = path.join(targetRoot, "skills", "main-skill");
  const preview = await cli.runJson([
    "install", "main-skill", "--target", "openai-codex", "--target-root", targetRoot, "--dry-run"
  ], options);
  assertSuccessfulEnvelope(preview.envelope, "install");
  assert.equal(preview.envelope.dryRun, true);
  assert.ok(preview.envelope.changes.length > 0);
  assert.ok(preview.envelope.changes.some((change) => change.path === targetPath
    && change.before.kind === "missing" && change.after.kind === "symlink"));
  assert.deepEqual((await cli.runJson(["list"], options)).envelope.result, []);
  await assertPathMissing(targetPath);
  await assertPathMissing(path.join(home, "receipts", "e2e", "assets", "main-skill.json"));

  assertSuccessfulEnvelope((await cli.runJson([
    "install", "main-skill", "--target", "openai-codex", "--target-root", targetRoot
  ], options)).envelope, "install");
  assert.equal((await lstat(targetPath)).isSymbolicLink(), true);
  const beforeUninstall = (await cli.runJson(["list"], options)).envelope.result.map((item) => item.coordinate);
  const uninstallPreview = await cli.runJson(["uninstall", "main-skill", "--dry-run"], options);
  assertSuccessfulEnvelope(uninstallPreview.envelope, "uninstall");
  assert.equal(uninstallPreview.envelope.dryRun, true);
  assert.equal(await pathExists(targetPath), true);
  assert.deepEqual(
    (await cli.runJson(["list"], options)).envelope.result.map((item) => item.coordinate),
    beforeUninstall
  );

  const conflict = await cli.runJson(["install", "conflicting-skill"], { ...options, expectExitCode: 1 });
  assertFailedEnvelope(conflict.envelope, "install", /Formula conflict:.*conflicts with/u);
  await assertPathMissing(path.join(home, "receipts", "e2e", "assets", "conflicting-skill.json"));

  await fixture.pushV2();
  const updatePreview = await cli.runJson(["update", "--dry-run"], options);
  assertSuccessfulEnvelope(updatePreview.envelope, "update");
  assert.equal(updatePreview.envelope.dryRun, true);
  assert.ok(updatePreview.envelope.changes.length > 0);
  const tapAfterPreview = (await cli.runJson(["tap", "list"], options)).envelope.result[0];
  assert.equal(tapAfterPreview.commit, fixture.v1Commit, "dry-run update must roll the Tap checkout and state back");

  return { initialCommit: fixture.v1Commit, previewedCommit: fixture.v2Commit };
}
