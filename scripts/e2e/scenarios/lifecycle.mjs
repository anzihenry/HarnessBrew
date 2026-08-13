import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import {
  assertFailedEnvelope,
  assertPathMissing,
  assertSuccessfulEnvelope,
  readJsonFile
} from "../assertions.mjs";
import { createTapFixture } from "../fixture-tap.mjs";

export async function lifecycleScenario({ environment, cli }) {
  const fixture = await createTapFixture(environment);

  const version = await cli.run(["--version"]);
  assert.equal(version.stdout.trim(), environment.artifact.package.version);
  const help = await cli.run(["help"]);
  assert.match(help.stdout, /Git-native package manager for AI Agent assets/u);

  const added = await cli.runJson(["tap", "add", fixture.name, fixture.remote]);
  assertSuccessfulEnvelope(added.envelope, "tap");
  assert.equal(added.envelope.result.name, fixture.name);
  assert.equal(added.envelope.result.trusted, false);
  assert.equal(added.envelope.result.commit, fixture.v1Commit);

  const taps = await cli.runJson(["tap", "list"]);
  assertSuccessfulEnvelope(taps.envelope, "tap");
  assert.equal(taps.envelope.result.length, 1);
  assert.equal(taps.envelope.result[0].name, fixture.name);

  const search = await cli.runJson(["search", "main-skill"]);
  assertSuccessfulEnvelope(search.envelope, "search");
  assert.deepEqual(search.envelope.result.map((formula) => formula.coordinate), ["e2e/assets/main-skill"]);
  const info = await cli.runJson(["info", "main-skill"]);
  assertSuccessfulEnvelope(info.envelope, "info");
  assert.equal(info.envelope.result.kind, "skill");
  assert.deepEqual(info.envelope.result.dependencies, ["e2e/assets/helper-skill"]);

  const installed = await cli.runJson(["install", "main-skill"]);
  assertSuccessfulEnvelope(installed.envelope, "install");
  assert.deepEqual(
    installed.envelope.result.map((receipt) => receipt.coordinate),
    ["e2e/assets/helper-skill", "e2e/assets/main-skill"]
  );
  const installedList = await cli.runJson(["list"]);
  assertSuccessfulEnvelope(installedList.envelope, "list");
  assert.deepEqual(
    installedList.envelope.result.map((receipt) => receipt.coordinate),
    ["e2e/assets/helper-skill", "e2e/assets/main-skill"]
  );

  const receiptPath = path.join(environment.paths.harnessHome, "receipts", "e2e", "assets", "main-skill.json");
  const receipt = await readJsonFile(receiptPath);
  assert.equal(receipt.commit, fixture.v1Commit);
  assert.deepEqual(receipt.dependencies, ["e2e/assets/helper-skill"]);
  assert.equal(receipt.operations.length, 0);
  assert.match(await readFile(path.join(receipt.cellarPath, "SKILL.md"), "utf8"), /v1/u);

  const untrustedLink = await cli.runJson([
    "link", "main-skill", "--target", "openai-codex", "--target-root", environment.paths.codexRoot
  ], { expectExitCode: 1 });
  assertFailedEnvelope(untrustedLink.envelope, "link", /not trusted/u);

  const trusted = await cli.runJson(["tap", "trust", fixture.name]);
  assertSuccessfulEnvelope(trusted.envelope, "tap");
  assert.equal(trusted.envelope.result.trusted, true);
  const linked = await cli.runJson([
    "link", "main-skill", "--target", "openai-codex", "--target-root", environment.paths.codexRoot
  ]);
  assertSuccessfulEnvelope(linked.envelope, "link");
  const targetPath = path.join(environment.paths.codexRoot, "skills", "main-skill");
  assert.equal((await lstat(targetPath)).isSymbolicLink(), true);

  const doctor = await cli.runJson(["doctor"]);
  assertSuccessfulEnvelope(doctor.envelope, "doctor");
  assert.equal(doctor.envelope.result.healthy, true);
  assert.equal(doctor.envelope.result.checked, 2);

  const unlinked = await cli.runJson([
    "unlink", "main-skill", "--target", "openai-codex", "--target-root", environment.paths.codexRoot
  ]);
  assertSuccessfulEnvelope(unlinked.envelope, "unlink");
  await assertPathMissing(targetPath);
  assertSuccessfulEnvelope((await cli.runJson(["uninstall", "main-skill"])).envelope, "uninstall");
  assertSuccessfulEnvelope((await cli.runJson(["uninstall", "helper-skill"])).envelope, "uninstall");
  assertSuccessfulEnvelope((await cli.runJson(["untap", fixture.name])).envelope, "untap");

  assert.deepEqual((await cli.runJson(["list"])).envelope.result, []);
  assert.deepEqual((await cli.runJson(["tap", "list"])).envelope.result, []);
  await assertPathMissing(path.join(environment.paths.harnessHome, "receipts", "e2e", "assets"));
  await assertPathMissing(path.join(environment.paths.harnessHome, "taps", "e2e", "assets"));

  return {
    tap: fixture.name,
    commit: fixture.v1Commit,
    installed: ["e2e/assets/helper-skill", "e2e/assets/main-skill"]
  };
}
