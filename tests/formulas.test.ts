import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { getFormula, searchFormulas } from "../src/core/formulas.js";
import { addTap } from "../src/core/taps.js";
import { addFormula, createTapRepository } from "./helpers/git.js";

test("formula catalog validates, searches, and resolves formulas", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-formulas-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "code-review", { tags: ["review", "quality"] });
  await addFormula(repository, "workflows", "release", { targets: ["claude-code"] });
  await addTap(home, "personal/agents", repository);

  const review = await getFormula(home, "code-review");
  assert.equal(review.coordinate, "personal/agents/code-review");
  assert.equal(review.kind, "skill");
  assert.deepEqual((await searchFormulas(home, "quality")).map((formula) => formula.name), ["code-review"]);
  assert.deepEqual(
    (await searchFormulas(home, "", { target: "claude-code" })).map((formula) => formula.name),
    ["release"]
  );
});

test("tap registration rejects invalid formulas", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-formulas-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "unsafe", { entry: "../outside.md" });

  await assert.rejects(addTap(home, "personal/agents", repository), /entry must stay inside/);
});
