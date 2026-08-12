import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { listInstalled } from "../src/core/installations.js";
import { addTap, updateTaps } from "../src/core/taps.js";
import { installForTarget, linkFormula } from "../src/core/targets.js";
import { findOutdated, upgradeFormulas } from "../src/core/upgrades.js";
import { addFormula, commitFile, createTapRepository } from "./helpers/git.js";

test("update and upgrade replace Cellar content while preserving target links", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-upgrade-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "code-review");
  await addTap(home, "personal/agents", repository, { trust: true });
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

test("agent upgrades regenerate target-native files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-upgrade-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "agents", "reviewer", { description: "Original reviewer" });
  await addTap(home, "personal/agents", repository, { trust: true });
  await installForTarget(home, "reviewer", "openai-codex", { root: targetRoot });

  await addFormula(repository, "agents", "reviewer", { description: "Updated reviewer" });
  await updateTaps(home);
  await upgradeFormulas(home, "reviewer");

  const destination = path.join(targetRoot, "agents", "reviewer.toml");
  assert.match(await readFile(destination, "utf8"), /description = "Updated reviewer"/);
  const [receipt] = await listInstalled(home);
  assert.equal(receipt?.operations[0]?.type, "render-file");
});

test("instruction upgrades replace only their managed Codex block", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-upgrade-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "instructions", "policies");
  await addTap(home, "personal/agents", repository, { trust: true });
  await mkdir(targetRoot, { recursive: true });
  const destination = path.join(targetRoot, "AGENTS.md");
  await writeFile(destination, "# User preface\nKeep forever.\n");
  await installForTarget(home, "policies", "openai-codex", { root: targetRoot });

  await commitFile(repository, "instructions/policies/content.md", "# policies\nUpdated policy.\n");
  await updateTaps(home);
  await upgradeFormulas(home, "policies");

  const content = await readFile(destination, "utf8");
  assert.match(content, /# User preface\nKeep forever\./u);
  assert.match(content, /Updated policy\./u);
  assert.equal(content.match(/harnessbrew:start personal\/agents\/policies/gu)?.length, 1);
});

test("workflow upgrades regenerate their projected skill", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-upgrade-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".claude");
  const repository = await createTapRepository(root);
  await addFormula(repository, "workflows", "release", { targets: ["claude-code"] });
  await addTap(home, "personal/agents", repository, { trust: true });
  await installForTarget(home, "release", "claude-code", { root: targetRoot });

  await commitFile(repository, "workflows/release/content.md", "# release\nRun updated checks.\n");
  await updateTaps(home);
  await upgradeFormulas(home, "release");

  const destination = path.join(targetRoot, "skills", "release", "SKILL.md");
  assert.match(await readFile(destination, "utf8"), /Run updated checks\./u);
  const [receipt] = await listInstalled(home);
  assert.equal(receipt?.operations[0]?.type, "render-file");
});

test("MCP upgrades replace only the owned Claude config key", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-upgrade-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".claude");
  const repository = await createTapRepository(root);
  await addFormula(repository, "mcp", "docs", { targets: ["claude-code"] });
  await commitFile(repository, "mcp/docs/content.md", JSON.stringify({ command: "docs-v1", envVars: ["DOCS_TOKEN"] }));
  await addTap(home, "personal/agents", repository, { trust: true });
  await mkdir(targetRoot, { recursive: true });
  const destination = path.join(targetRoot, ".mcp.json");
  await writeFile(destination, `${JSON.stringify({ userSetting: true }, null, 2)}\n`);
  await installForTarget(home, "docs", "claude-code", { root: targetRoot });

  await commitFile(repository, "mcp/docs/content.md", JSON.stringify({ command: "docs-v2", args: ["serve"] }));
  await updateTaps(home);
  await upgradeFormulas(home, "docs");

  const configuration = JSON.parse(await readFile(destination, "utf8")) as {
    userSetting: boolean;
    mcpServers: Record<string, { command: string; args: string[] }>;
  };
  assert.equal(configuration.userSetting, true);
  assert.equal(configuration.mcpServers.docs?.command, "docs-v2");
  assert.deepEqual(configuration.mcpServers.docs?.args, ["serve"]);
});

test("upgrades preserve multiple scopes for the same target", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-upgrade-"));
  const home = path.join(root, "home");
  const userRoot = path.join(root, "user-codex");
  const projectRoot = path.join(root, "project");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "review");
  await addTap(home, "personal/agents", repository, { trust: true });
  await installForTarget(home, "review", "openai-codex", { scope: "user", root: userRoot });
  await linkFormula(home, "review", "openai-codex", { scope: "project", projectRoot });

  await addFormula(repository, "skills", "review", { description: "Updated scoped review" });
  await updateTaps(home);
  await upgradeFormulas(home, "review");

  assert.equal((await lstat(path.join(userRoot, "skills", "review"))).isSymbolicLink(), true);
  assert.equal((await lstat(path.join(projectRoot, ".agents", "skills", "review"))).isSymbolicLink(), true);
  const [receipt] = await listInstalled(home);
  assert.equal(receipt?.operations.length, 2);
  assert.deepEqual(receipt?.operations.map((operation) => operation.scope).sort(), ["project", "user"]);
});
