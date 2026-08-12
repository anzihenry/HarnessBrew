import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { installFormula, listInstalled, readReceipt, uninstallFormula, verifyCellarIntegrity } from "../src/core/installations.js";
import { resolveReceiptPath } from "../src/core/paths.js";
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

test("Cellar integrity rejects added files and unsupported entries", async () => {
  const { home } = await setupDependencyTap();
  const receipts = await installFormula(home, "code-review");
  const receipt = receipts.at(-1);
  assert.ok(receipt);
  await writeFile(path.join(receipt.cellarPath, "injected.sh"), "echo injected\n");
  await assert.rejects(verifyCellarIntegrity(receipt), /injected\.sh/);
});

test("Cellar integrity detects permission changes for new receipts", async () => {
  const { home } = await setupDependencyTap();
  const receipts = await installFormula(home, "code-review");
  const receipt = receipts.at(-1);
  assert.ok(receipt);
  const entry = path.join(receipt.cellarPath, receipt.entry);
  const recordedMode = receipt.files.find((file) => file.path === receipt.entry)?.mode;
  assert.notEqual(recordedMode, undefined);
  await chmod(entry, recordedMode === 0o600 ? 0o644 : 0o600);
  await assert.rejects(verifyCellarIntegrity(receipt), new RegExp(receipt.entry));
});

test("receipt loading rejects unsafe paths and malformed operations", async () => {
  const { home } = await setupDependencyTap();
  const [receipt] = await installFormula(home, "guardrails");
  assert.ok(receipt);
  const receiptPath = resolveReceiptPath(home, receipt.coordinate);
  const stored = JSON.parse(await readFile(receiptPath, "utf8")) as Record<string, unknown>;
  stored.operations = [{
    id: "malicious",
    type: "symlink-directory",
    target: "openai-codex",
    destination: path.parse(home).root,
    source: receipt.cellarPath,
    createdDirectories: [path.parse(home).root]
  }];
  await writeFile(receiptPath, `${JSON.stringify(stored)}\n`);
  await assert.rejects(readReceipt(home, receipt.coordinate), /Invalid install receipt/);

  await mkdir(path.dirname(receiptPath), { recursive: true });
  stored.operations = [];
  stored.files = [{ path: "../outside", sha256: "a".repeat(64) }];
  await writeFile(receiptPath, `${JSON.stringify(stored)}\n`);
  await assert.rejects(readReceipt(home, receipt.coordinate), /Invalid install receipt/);

  stored.files = [];
  stored.cellarPath = path.parse(home).root;
  await writeFile(receiptPath, `${JSON.stringify(stored)}\n`);
  await assert.rejects(readReceipt(home, receipt.coordinate), /Invalid install receipt/);
});
