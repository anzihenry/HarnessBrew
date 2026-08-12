import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { listInstalled } from "../src/core/installations.js";
import { addTap, updateTaps } from "../src/core/taps.js";
import { installForTarget } from "../src/core/targets.js";
import { findOutdated, upgradeFormulas } from "../src/core/upgrades.js";
import { addFormula, createTapRepository } from "./helpers/git.js";

test("update and upgrade replace Cellar content while preserving target links", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-upgrade-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "code-review");
  await addTap(home, "personal/agents", repository);
  const [original] = await installForTarget(home, "code-review", "openai-codex", { root: targetRoot });
  assert.ok(original);

  await addFormula(repository, "skills", "code-review", { description: "updated review formula" });
  await updateTaps(home);
  const [outdated] = await findOutdated(home);
  assert.equal(outdated?.coordinate, "personal/agents/code-review");

  const [upgrade] = await upgradeFormulas(home, "code-review");
  assert.ok(upgrade);
  assert.notEqual(upgrade.before, upgrade.after);
  const [current] = await listInstalled(home);
  assert.ok(current);
  assert.equal(current.commit, upgrade.after);
  assert.notEqual(current.cellarPath, original.cellarPath);
  const destination = path.join(targetRoot, "skills", "code-review");
  assert.equal((await lstat(destination)).isSymbolicLink(), true);
  assert.match(await readFile(path.join(destination, "SKILL.md"), "utf8"), /code-review/);
  assert.match(await readFile(path.join(current.cellarPath, "formula.json"), "utf8"), /updated review formula/);
  assert.deepEqual(await findOutdated(home), []);
});
