import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("managed-block operations preserve surrounding user content", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-transaction-"));
  const destination = path.join(root, "AGENTS.md");
  await writeFile(destination, "# User instructions\nKeep this line.\n");
  const [operation] = await executeTargetOperations([{
    id: "instruction",
    type: "managed-block",
    target: "openai-codex",
    destination,
    marker: "personal/agents/security",
    content: "# Security\nNever expose secrets.\n"
  }]);
  assert.ok(operation);
  assert.match(await readFile(destination, "utf8"), /harnessbrew:start personal\/agents\/security/u);
  await verifyTargetOperation(operation);
  const installedContent = await readFile(destination, "utf8");
  await assert.rejects(executeTargetOperations([{
    id: "duplicate",
    type: "managed-block",
    target: "openai-codex",
    destination,
    marker: "personal/agents/security",
    content: "duplicate\n"
  }]), /already exists/);
  assert.equal(await readFile(destination, "utf8"), installedContent);
  await removeTargetOperation(operation);
  assert.equal(await readFile(destination, "utf8"), "# User instructions\nKeep this line.\n");
});

test("merge-config operations own only their TOML block or JSON key", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-transaction-"));
  const tomlPath = path.join(root, "config.toml");
  const jsonPath = path.join(root, ".mcp.json");
  await writeFile(tomlPath, "model = \"gpt-5\"\n");
  await writeFile(jsonPath, `${JSON.stringify({ theme: "dark", mcpServers: { user: { command: "user-server" } } }, null, 2)}\n`);
  const [tomlOperation, jsonOperation] = await executeTargetOperations([
    {
      id: "codex-mcp",
      type: "merge-config",
      target: "openai-codex",
      destination: tomlPath,
      marker: "personal/agents/docs",
      configFormat: "toml-block",
      ownedKeys: ["mcp_servers", "docs"],
      content: "[mcp_servers.docs]\ncommand = \"docs-server\"\n"
    },
    {
      id: "claude-mcp",
      type: "merge-config",
      target: "claude-code",
      destination: jsonPath,
      configFormat: "json",
      ownedKeys: ["mcpServers", "docs"],
      content: JSON.stringify({ type: "stdio", command: "docs-server" })
    }
  ]);
  assert.ok(tomlOperation && jsonOperation);
  await verifyTargetOperation(tomlOperation);
  await verifyTargetOperation(jsonOperation);
  const json = JSON.parse(await readFile(jsonPath, "utf8")) as { theme: string; mcpServers: Record<string, unknown> };
  assert.equal(json.theme, "dark");
  assert.deepEqual(Object.keys(json.mcpServers).sort(), ["docs", "user"]);

  await removeTargetOperation(jsonOperation);
  await removeTargetOperation(tomlOperation);
  assert.match(await readFile(tomlPath, "utf8"), /^model = "gpt-5"/u);
  const remainingJson = JSON.parse(await readFile(jsonPath, "utf8")) as { theme: string; mcpServers: Record<string, unknown> };
  assert.equal(remainingJson.theme, "dark");
  assert.deepEqual(Object.keys(remainingJson.mcpServers), ["user"]);
});

test("concurrent target config merges preserve updates from separate transactions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-transaction-"));
  const destination = path.join(root, ".mcp.json");
  const operation = (name: string) => executeTargetOperations([{
    id: name,
    type: "merge-config" as const,
    target: "claude-code",
    destination,
    configFormat: "json" as const,
    ownedKeys: ["mcpServers", name],
    content: JSON.stringify({ type: "stdio", command: `${name}-server` })
  }]);

  const [[docs], [search]] = await Promise.all([operation("docs"), operation("search")]);
  assert.ok(docs && search);
  const configuration = JSON.parse(await readFile(destination, "utf8")) as {
    mcpServers: Record<string, { command: string }>;
  };
  assert.deepEqual(Object.keys(configuration.mcpServers).sort(), ["docs", "search"]);
  assert.equal(configuration.mcpServers.docs?.command, "docs-server");
  assert.equal(configuration.mcpServers.search?.command, "search-server");
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
    description: "Example skill",
    tap: "personal/agents",
    commit: "a".repeat(40),
    cellarPath: path.join(root, "cellar", "personal", "agents", "example", "a".repeat(40)),
    entry: "SKILL.md",
    dependencies: [],
    conflicts: [],
    requested: true,
    files: [],
    supportedTargets: ["openai-codex"],
    targets: ["openai-codex"],
    links: [{
      path: "/target/SKILL.md",
      source: path.join(root, "cellar", "personal", "agents", "example", "a".repeat(40), "SKILL.md"),
      target: "openai-codex",
      sha256: "a".repeat(64)
    }],
    installedAt: "2026-08-12T00:00:00.000Z"
  })}\n`);

  const receipt = await readReceipt(root, coordinate);
  assert.equal(receipt?.schemaVersion, 2);
  assert.equal(receipt?.operations[0]?.type, "symlink-file");
  assert.equal(receipt?.operations[0]?.destination, "/target/SKILL.md");
});

test("forced symlink removal never deletes a replacement directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-transaction-"));
  const source = path.join(root, "source");
  const destination = path.join(root, "target", "skill");
  await mkdir(source);
  const [operation] = await executeTargetOperations([{
    id: "skill",
    type: "symlink-directory",
    target: "openai-codex",
    source,
    destination
  }]);
  assert.ok(operation);
  await rm(destination);
  await mkdir(destination);
  await writeFile(path.join(destination, "user.txt"), "keep\n");

  await removeTargetOperation(operation, true);
  assert.equal(await readFile(path.join(destination, "user.txt"), "utf8"), "keep\n");
});
