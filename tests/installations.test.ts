import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { installFormula, listInstalled, uninstallFormula } from "../src/core/installations.js";
import { addTap } from "../src/core/taps.js";
import { addFormula, createTapRepository } from "./helpers/git.js";

async function setupDependencyTap(): Promise<{ home: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-install-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);
  await addFormula(repository, "instructions", "guardrails");
  await addFormula(repository, "skills", "code-review", {
    dependencies: ["personal/agents/guardrails"]
  });
  await addTap(home, "personal/agents", repository);
  return { home };
}

test("install resolves dependencies into immutable Cellar receipts", async () => {
  const { home } = await setupDependencyTap();
  const receipts = await installFormula(home, "code-review");

  assert.deepEqual(receipts.map((receipt) => receipt.coordinate), [
    "personal/agents/guardrails",
    "personal/agents/code-review"
  ]);
  assert.equal(receipts[0]?.requested, false);
  assert.equal(receipts[1]?.requested, true);
  assert.equal((await listInstalled(home)).length, 2);
});

test("uninstall protects dependencies and modified Cellar files", async () => {
  const { home } = await setupDependencyTap();
  const receipts = await installFormula(home, "code-review");
  await assert.rejects(uninstallFormula(home, "guardrails"), /required by/);

  await uninstallFormula(home, "code-review");
  const dependency = receipts[0];
  assert.ok(dependency);
  await writeFile(path.join(dependency.cellarPath, dependency.entry), "modified\n", "utf8");
  await assert.rejects(uninstallFormula(home, "guardrails"), /were modified/);
  await uninstallFormula(home, "guardrails", { force: true });
  assert.deepEqual(await listInstalled(home), []);
});

test("install rejects declared conflicts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-install-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "first");
  await addFormula(repository, "skills", "second", { conflicts: ["personal/agents/first"] });
  await addTap(home, "personal/agents", repository);

  await installFormula(home, "first");
  await assert.rejects(installFormula(home, "second"), /Formula conflict/);
});
