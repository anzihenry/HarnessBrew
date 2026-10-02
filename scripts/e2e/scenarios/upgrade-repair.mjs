import assert from "node:assert/strict";
import { readFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { createTapFixture } from "../fixture-tap.mjs";
export async function upgradeRepairScenario({ environment, cli }) {
  const fixture = await createTapFixture(environment, { id: "upgrade" });
  const home = path.join(environment.root, "upgrade-home"), root = path.join(environment.root, "upgrade-target");
  const run = (args, options) => cli.runJson([...args, "--home", home], options);
  await run(["tap", "add", fixture.name, fixture.remote]); await run(["tap", "trust", fixture.name]);
  await run(["install", "main-skill", "--root", root]);
  await fixture.pushV2(); await run(["tap", "update"]);
  assert.ok((await run(["outdated"])).envelope.result.length > 0); await run(["upgrade", "main-skill"]);
  const target = path.join(root, "skills", "main-skill"); assert.match(await readFile(path.join(target, "SKILL.md"), "utf8"), /v2/u);
  const before = await readFile(path.join(home, "CURRENT")); await fixture.pushInvalidCandidate();
  await run(["tap", "update"], { expectExitCode: 2 }); assert.deepEqual(await readFile(path.join(home, "CURRENT")), before);
  await fixture.repairInvalidCandidate(); await run(["tap", "update"]);
  await fixture.rewriteFromV1(); const rewind = await run(["tap", "update"], { expectExitCode: 1 }); assert.equal(rewind.envelope.error.code, "SOURCE_REWIND");
  await run(["tap", "update", "--allow-rewind"]);
  await rm(target); assert.equal((await run(["doctor"], { expectExitCode: 1 })).envelope.result.healthy, false);
  await run(["repair", "main-skill"]); assert.equal((await run(["doctor"])).envelope.result.healthy, true);
  await rm(target); await symlink("/unmanaged/content", target);
  await run(["repair", "main-skill", "--overwrite-owned"], { expectExitCode: 1 });
}
