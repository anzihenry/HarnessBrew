import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { installFormula, listInstalled } from "../src/core/installations.js";
import { installForTarget } from "../src/core/targets.js";
import { addTap, updateTaps } from "../src/core/taps.js";
import { upgradeFormulas } from "../src/core/upgrades.js";
import { addFormula, createTapRepository } from "./helpers/git.js";

// Executable regression fixtures against the old entry points. These remain TODO until
// stages 3–6 connect the new resolver/application service; TODO failures are not passes.
async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-regression-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);
  return { root, home, repository };
}
test("A02: upgrading a root installs its newly introduced dependency", { todo: "Stage 3 resolver and stage 6 application integration" }, async t => {
  const { home, repository } = await fixture(t);
  await addFormula(repository, "skills", "a");
  await addTap(home, "test/assets", repository);
  await installFormula(home, "a");
  await addFormula(repository, "skills", "b");
  await addFormula(repository, "skills", "a", { dependencies: ["test/assets/b"] });
  await updateTaps(home);
  await upgradeFormulas(home, "a");
  assert.deepEqual((await listInstalled(home)).map(asset => asset.coordinate).sort(), ["test/assets/a", "test/assets/b"]);
});
test("A03: upgrading into a conflict fails without changing installed versions", { todo: "Stage 3 final-state constraint validation" }, async t => {
  const { home, repository } = await fixture(t);
  await addFormula(repository, "skills", "a");
  await addFormula(repository, "skills", "c");
  await addTap(home, "test/assets", repository);
  await installFormula(home, "a"); await installFormula(home, "c");
  const before = await listInstalled(home);
  await addFormula(repository, "skills", "a", { conflicts: ["test/assets/c"] });
  await updateTaps(home);
  await assert.rejects(upgradeFormulas(home, "a"));
  assert.deepEqual(await listInstalled(home), before);
});
test("A05: a failed installation preserves an already linked dependency", { todo: "Stage 5 transaction and stage 6 public API integration" }, async t => {
  const { root, home, repository } = await fixture(t);
  await addFormula(repository, "skills", "b");
  await addFormula(repository, "skills", "a", { dependencies: ["test/assets/b"], targets: ["another-target"] });
  await addTap(home, "test/assets", repository, { trust: true });
  const options = { root: path.join(root, "target") };
  await installForTarget(home, "b", "openai-codex", options);
  const before = await listInstalled(home);
  await assert.rejects(installForTarget(home, "a", "openai-codex", options));
  assert.deepEqual(await listInstalled(home), before);
});
