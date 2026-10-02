import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createTapFixture } from "../fixture-tap.mjs";
export async function bundleReproductionScenario({ environment, cli }) {
  const fixture = await createTapFixture(environment, { id: "bundle" });
  const manifest = { format: "harnessbrew.manifest", version: 1, id: "team", sources: [{ name: fixture.name, git: fixture.remote }], assets: [{ coordinate: "e2e/assets/main-skill", placements: [{ target: "openai-codex", scope: "project", project: "." }] }] };
  let lock, assets;
  for (const machine of ["a", "b"]) {
    const cwd = path.join(environment.root, `bundle-machine-${machine}`), home = path.join(environment.root, `bundle-home-${machine}`); await mkdir(cwd);
    const file = path.join(cwd, "Harnessfile.yaml"); await writeFile(file, JSON.stringify(manifest));
    const run = args => cli.runJson([...args, "--home", home], { cwd });
    await run(["tap", "add", fixture.name, fixture.remote]); await run(["tap", "trust", fixture.name]);
    if (lock) await writeFile(`${file}.lock.json`, lock);
    await run(["bundle", "apply", "--file", file]);
    const state = (await run(["list"])).envelope.result;
    const pins = state.assets.map(({ coordinate, commit, contentDigest }) => ({ coordinate, commit, contentDigest }));
    if (assets) assert.deepEqual(pins, assets); else assets = pins;
    const bytes = await readFile(`${file}.lock.json`, "utf8");
    assert.ok(!bytes.includes(home)); assert.ok(!bytes.includes(cwd));
    if (lock) assert.equal(bytes, lock); else lock = bytes;
    assert.equal((await run(["doctor"])).envelope.result.healthy, true);
    await run(["bundle", "detach", "--binding", state.owners[0].id]); await run(["cleanup"]);
    assert.deepEqual((await run(["list"])).envelope.result.assets, []);
    if (machine === "a") await fixture.pushV2();
  }
}
