import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertFailedEnvelope, assertSuccessfulEnvelope, readJsonFile } from "../assertions.mjs";
import { createTapFixture } from "../fixture-tap.mjs";

export async function upgradeRepairScenario({ environment, cli }) {
  const fixture = await createTapFixture(environment, { id: "upgrade-repair" });
  assertSuccessfulEnvelope((await cli.runJson(["tap", "add", fixture.name, fixture.remote, "--trust"])).envelope, "tap");

  assertSuccessfulEnvelope((await cli.runJson([
    "install", "main-skill", "--target", "openai-codex", "--scope", "user", "--target-root", environment.paths.codexRoot
  ])).envelope, "install");
  assertSuccessfulEnvelope((await cli.runJson([
    "link", "main-skill", "--target", "openai-codex", "--scope", "project", "--project", environment.paths.project
  ])).envelope, "link");
  assertSuccessfulEnvelope((await cli.runJson([
    "install", "runtime-instruction", "--target", "openai-codex", "--target-root", environment.paths.codexRoot
  ])).envelope, "install");
  assertSuccessfulEnvelope((await cli.runJson([
    "install", "runtime-workflow", "--target", "claude-code", "--target-root", environment.paths.claudeRoot
  ])).envelope, "install");

  const v2Commit = await fixture.pushV2();
  const update = await cli.runJson(["update"]);
  assertSuccessfulEnvelope(update.envelope, "update");
  assert.equal(update.envelope.result[0].after, v2Commit);
  const outdated = await cli.runJson(["outdated"]);
  assertSuccessfulEnvelope(outdated.envelope, "outdated");
  assert.ok(outdated.envelope.result.some((item) => item.coordinate === "e2e/assets/main-skill" && item.available));
  const upgraded = await cli.runJson(["upgrade"]);
  assertSuccessfulEnvelope(upgraded.envelope, "upgrade");
  assert.ok(upgraded.envelope.result.some((item) => item.coordinate === "e2e/assets/main-skill" && item.after === v2Commit));

  const userSkill = path.join(environment.paths.codexRoot, "skills", "main-skill", "references", "version.txt");
  const projectSkillRoot = path.join(environment.paths.project, ".agents", "skills", "main-skill");
  const projectSkill = path.join(projectSkillRoot, "references", "version.txt");
  const instruction = path.join(environment.paths.codexRoot, "AGENTS.md");
  const workflow = path.join(environment.paths.claudeRoot, "skills", "runtime-workflow", "SKILL.md");
  assert.match(await readFile(userSkill, "utf8"), /v2/u);
  assert.match(await readFile(projectSkill, "utf8"), /v2/u);
  assert.match(await readFile(instruction, "utf8"), /runtime-instruction v2/u);
  assert.match(await readFile(workflow, "utf8"), /runtime-workflow v2/u);

  await fixture.pushInvalidCandidate();
  const invalid = await cli.runJson(["update"], { expectExitCode: 1 });
  assertFailedEnvelope(invalid.envelope, "update", /Unsupported formula schema/u);
  const tapAfterInvalid = (await cli.runJson(["tap", "list"])).envelope.result[0];
  assert.equal(tapAfterInvalid.commit, v2Commit, "invalid update must leave the managed Tap at v2");
  await fixture.repairInvalidCandidate();
  assertSuccessfulEnvelope((await cli.runJson(["update"])).envelope, "update");
  const rewrittenCommit = await fixture.rewriteFromV1();
  assertFailedEnvelope((await cli.runJson(["update"], { expectExitCode: 1 })).envelope, "update", /not a fast-forward/u);
  const rewind = await cli.runJson(["update", "--allow-rewind"]);
  assertSuccessfulEnvelope(rewind.envelope, "update");
  assert.equal(rewind.envelope.result[0].after, rewrittenCommit);

  await rm(projectSkillRoot, { force: false });
  const modifiedInstruction = (await readFile(instruction, "utf8")).replace("runtime-instruction v2", "runtime-instruction modified");
  await writeFile(instruction, modifiedInstruction, "utf8");
  const unhealthy = await cli.runJson(["doctor"], { expectExitCode: 1 });
  assert.equal(unhealthy.envelope.result.healthy, false);
  assert.ok(unhealthy.envelope.result.findings.some((finding) => finding.kind === "target-missing"));
  assert.ok(unhealthy.envelope.result.findings.some((finding) => finding.kind === "target-modified"));

  assertSuccessfulEnvelope((await cli.runJson([
    "relink", "main-skill", "--target", "openai-codex", "--scope", "project", "--project", environment.paths.project
  ])).envelope, "relink");
  assertSuccessfulEnvelope((await cli.runJson([
    "relink", "runtime-instruction", "--target", "openai-codex", "--scope", "user", "--target-root", environment.paths.codexRoot
  ])).envelope, "relink");
  assertSuccessfulEnvelope((await cli.runJson(["doctor"])).envelope, "doctor");

  const receipt = await readJsonFile(path.join(
    environment.paths.harnessHome, "receipts", "e2e", "assets", "main-skill.json"
  ));
  await writeFile(path.join(receipt.cellarPath, "SKILL.md"), "damaged cellar\n", "utf8");
  const damaged = await cli.runJson(["doctor", "main-skill"], { expectExitCode: 1 });
  assert.ok(damaged.envelope.result.findings.some((finding) => finding.kind === "cellar-modified"));
  assertFailedEnvelope((await cli.runJson([
    "relink", "main-skill", "--target", "openai-codex", "--scope", "user", "--target-root", environment.paths.codexRoot
  ], { expectExitCode: 1 })).envelope, "relink", /Cellar|modified/iu);

  return { v1Commit: fixture.v1Commit, v2Commit, rewrittenCommit };
}
