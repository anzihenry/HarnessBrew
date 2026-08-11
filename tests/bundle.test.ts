import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { bundleCleanup, bundleInstall, lockfilePath } from "../src/core/bundle.js";
import { listInstalled } from "../src/core/installations.js";
import { addFormula, createTapRepository } from "./helpers/git.js";

test("bundle install locks taps and dependency closure and cleanup removes unmanaged formulas", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-bundle-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "instructions", "guardrails");
  await addFormula(repository, "skills", "code-review", { dependencies: ["personal/agents/guardrails"] });
  const harnessfile = path.join(root, "Harnessfile");
  await writeFile(harnessfile, `schemaVersion: 1
taps:
  - name: personal/agents
    git: ${JSON.stringify(repository)}
assets:
  - formula: personal/agents/code-review
    targets: [openai-codex]
`, "utf8");

  const lock = await bundleInstall(home, harnessfile, { targetRoots: { "openai-codex": targetRoot } });
  assert.equal(lock.taps.length, 1);
  assert.deepEqual(lock.assets.map((asset) => asset.formula), [
    "personal/agents/code-review",
    "personal/agents/guardrails"
  ]);
  assert.deepEqual(JSON.parse(await readFile(lockfilePath(harnessfile), "utf8")), lock);

  await writeFile(harnessfile, `schemaVersion: 1
taps:
  - name: personal/agents
    git: ${JSON.stringify(repository)}
assets: []
`, "utf8");
  const cleanup = await bundleCleanup(home, harnessfile);
  assert.deepEqual(new Set(cleanup.removed), new Set([
    "personal/agents/code-review",
    "personal/agents/guardrails"
  ]));
  assert.deepEqual(await listInstalled(home), []);
});

test("bundle lock reproduces an exact Tap commit in a new home", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-bundle-"));
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "code-review");
  const harnessfile = path.join(root, "Harnessfile");
  await writeFile(harnessfile, `schemaVersion: 1
taps:
  - name: personal/agents
    git: ${JSON.stringify(repository)}
assets:
  - formula: personal/agents/code-review
    targets: []
`, "utf8");
  const first = await bundleInstall(path.join(root, "home-one"), harnessfile);
  await addFormula(repository, "skills", "code-review", { description: "newer" });
  const second = await bundleInstall(path.join(root, "home-two"), harnessfile);
  assert.equal(second.taps[0]?.commit, first.taps[0]?.commit);
  assert.equal(second.assets[0]?.commit, first.assets[0]?.commit);
});
