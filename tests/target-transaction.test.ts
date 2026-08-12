import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readReceipt } from "../src/core/installations.js";
import { resolveReceiptPath } from "../src/core/paths.js";
import {
  executeTargetOperations,
  removeTargetOperation,
  verifyTargetOperation
} from "../src/core/targets/transaction.js";

test("target transaction installs, verifies, and removes links and rendered files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-transaction-"));
  const sourceDirectory = path.join(root, "source");
  await mkdir(sourceDirectory);
  await writeFile(path.join(sourceDirectory, "SKILL.md"), "skill\n");
  const operations = await executeTargetOperations([
    {
      id: "skill",
      type: "symlink-directory",
      target: "openai-codex",
      source: sourceDirectory,
      destination: path.join(root, "target", "skills", "example")
    },
    {
      id: "agent",
      type: "render-file",
      target: "openai-codex",
      content: "name = \"reviewer\"\n",
      destination: path.join(root, "target", "agents", "reviewer.toml")
    }
  ]);

  assert.equal((await lstat(operations[0]?.destination ?? "")).isSymbolicLink(), true);
  assert.equal(await readFile(operations[1]?.destination ?? "", "utf8"), "name = \"reviewer\"\n");
  for (const operation of operations) await verifyTargetOperation(operation);
  for (const operation of [...operations].reverse()) await removeTargetOperation(operation);
  await assert.rejects(lstat(path.join(root, "target")), /ENOENT/);
});

test("target transaction rolls back earlier operations when a later operation fails", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-transaction-"));
  const first = path.join(root, "target", "first.md");
  const occupied = path.join(root, "occupied.md");
  await writeFile(occupied, "user content\n");
  await assert.rejects(executeTargetOperations([
    { id: "first", type: "render-file", target: "test", destination: first, content: "managed\n" },
    { id: "second", type: "render-file", target: "test", destination: occupied, content: "replace\n" }
  ]), /already exists/);
  await assert.rejects(lstat(first), /ENOENT/);
  assert.equal(await readFile(occupied, "utf8"), "user content\n");
});

test("version one receipts are normalized to version two operations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-receipt-"));
  const coordinate = "personal/agents/example";
  const receiptPath = resolveReceiptPath(root, coordinate);
  await mkdir(path.dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify({
    schemaVersion: 1,
    coordinate,
    kind: "skill",
    tap: "personal/agents",
    commit: "a".repeat(40),
    cellarPath: "/cellar/example",
    entry: "SKILL.md",
    dependencies: [],
    conflicts: [],
    requested: true,
    files: [],
    supportedTargets: ["openai-codex"],
    targets: ["openai-codex"],
    links: [{ path: "/target/SKILL.md", source: "/cellar/example/SKILL.md", target: "openai-codex", sha256: "abc" }],
    installedAt: "2026-08-12T00:00:00.000Z"
  })}\n`);

  const receipt = await readReceipt(root, coordinate);
  assert.equal(receipt?.schemaVersion, 2);
  assert.equal(receipt?.operations[0]?.type, "symlink-file");
  assert.equal(receipt?.operations[0]?.destination, "/target/SKILL.md");
});
