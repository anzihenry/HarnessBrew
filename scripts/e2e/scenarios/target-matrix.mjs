import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTapFixture } from "../fixture-tap.mjs";
export async function targetMatrixScenario({ environment, cli }) {
  const fixture = await createTapFixture(environment, { id: "matrix" });
  const home = path.join(environment.root, "matrix-home"), userRoot = path.join(environment.root, "matrix-user"), project = path.join(environment.root, "matrix-project");
  await mkdir(userRoot); await mkdir(project);
  const run = (args, options) => cli.runJson([...args, "--home", home], options);
  await run(["tap", "add", fixture.name, fixture.remote]); await run(["tap", "trust", fixture.name]);
  const preserved = [[path.join(userRoot, "AGENTS.md"), "# User instructions\n"], [path.join(project, "AGENTS.md"), "# Project instructions\n"], [path.join(userRoot, "config.toml"), 'model = "user"\n']];
  for (const [file, text] of preserved) await writeFile(file, text);
  for (const name of ["main-skill", "runtime-agent", "runtime-workflow", "runtime-instruction", "runtime-prompt", "runtime-mcp"]) {
    await run(["install", name, "--scope", "user", "--root", userRoot]);
    for (const scope of ["user", "project"]) {
      const args = scope === "user" ? ["--scope", scope, "--root", userRoot] : ["--scope", scope, "--project", project];
      await run(["link", name, ...args]);
    }
  }
  assert.equal((await run(["doctor"])).envelope.result.healthy, true);
  const state = (await run(["list"])).envelope.result;
  for (const requirement of state.requirements) assert.equal(requirement.placements.length, 2);
  for (const [file, text] of preserved) assert.ok((await readFile(file, "utf8")).includes(text));
  for (const name of ["main-skill", "runtime-agent", "runtime-workflow", "runtime-instruction", "runtime-prompt", "runtime-mcp"]) await run(["remove", name]);
  for (const [file, text] of preserved) assert.equal((await readFile(file, "utf8")).trimEnd(), text.trimEnd());
}
