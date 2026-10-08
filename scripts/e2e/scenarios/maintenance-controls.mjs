import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createTapFixture } from "../fixture-tap.mjs";
export async function maintenanceControlsScenario({ environment, cli }) {
  const fixture = await createTapFixture(environment, { id: "maintenance-controls" });
  const home = path.join(environment.root, "maintenance-home"), root = path.join(environment.root, "maintenance-target");
  const run = (args, options) => cli.runJson([...args, "--home", home], options);
  await run(["tap", "add", fixture.name, fixture.remote]);
  await run(["tap", "trust", fixture.name]);
  const install = await run(["install", "main-skill", "--root", root, "--progress"]);
  assert.equal(install.envelope.result.outcome, "committed");
  assert.ok(install.envelope.result.effects.some(effect => effect.kind === "asset"));
  assert.match(install.stderr, /\[apply\]/u); assert.match(install.stderr, /\[complete\]/u);
  const plan = await run(["remove", "main-skill", "--dry-run"]);
  const current = await readFile(path.join(home, "CURRENT"));
  const preview = await run(["maintenance", "--dry-run", "--ttl-days", "0", "--keep-newest", "0"]);
  assert.ok(preview.envelope.result.objects.some(object => object.path.endsWith(`${plan.envelope.result.planId}.json`) && object.status === "protected"));
  const applied = await run(["apply-maintenance", preview.envelope.result.planId]);
  assert.equal(applied.envelope.result.status, "complete");
  assert.deepEqual(await readFile(path.join(home, "CURRENT")), current);
  assert.equal((await run(["doctor"])).envelope.result.healthy, true);
  const timeout = await run(["list", "--timeout-ms", "0"], { expectExitCode: 124 });
  assert.equal(timeout.envelope.error.code, "OPERATION_TIMEOUT");
  await run(["apply-plan", plan.envelope.result.planId]);
}
