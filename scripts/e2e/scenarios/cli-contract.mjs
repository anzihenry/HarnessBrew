import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createTapFixture } from "../fixture-tap.mjs";
export async function cliContractScenario({ environment, cli }) {
  const fixture = await createTapFixture(environment, { id: "contract" });
  const home = path.join(environment.root, "contract-home"), root = path.join(environment.root, "contract-target");
  const run = (args, options) => cli.runJson([...args, "--home", home], options);
  const preview = await run(["tap", "add", fixture.name, fixture.remote, "--dry-run"]);
  assert.equal(preview.envelope.mode, "preview"); await run(["apply-plan", preview.envelope.result.planId]);
  const before = await readFile(path.join(home, "CURRENT"));
  await run(["tap", "trust", fixture.name, "--dry-run"]); assert.deepEqual(await readFile(path.join(home, "CURRENT")), before);
  await run(["tap", "trust", fixture.name]);
  const planned = await run(["install", "main-skill", "--root", root, "--dry-run"]);
  assert.ok(planned.envelope.result.fileUpdates.length > 0); await run(["apply-plan", planned.envelope.result.planId]);
  const current = await readFile(path.join(home, "CURRENT"));
  await run(["remove", "main-skill", "--dry-run"]); assert.deepEqual(await readFile(path.join(home, "CURRENT")), current);
  const invalid = await run(["missing-command"], { expectExitCode: 2 }); assert.equal(invalid.envelope.error.code, "INVALID_ARGUMENT");
  const missing = await run(["install", "missing"], { expectExitCode: 1 }); assert.equal(missing.envelope.error.code, "ASSET_NOT_FOUND");
  await run(["list", "--wat"], { expectExitCode: 2 });
}
