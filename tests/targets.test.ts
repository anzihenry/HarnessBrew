import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { installFormula, listInstalled, uninstallFormula } from "../src/core/installations.js";
import { addTap } from "../src/core/taps.js";
import { installForTarget, linkFormula, unlinkFormula } from "../src/core/targets.js";
import { addFormula, createTapRepository, git } from "./helpers/git.js";

test("Codex adapter links skill entries and uninstall removes owned links", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-targets-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "code-review");
  await writeFile(path.join(repository, "skills", "code-review", "reference.md"), "reference material\n");
  await git(repository, "add", "skills/code-review/reference.md");
  await git(repository, "commit", "-m", "add skill reference");
  await addTap(home, "personal/agents", repository);

  const [receipt] = await installForTarget(home, "code-review", "openai-codex", { root: targetRoot });
  assert.ok(receipt);
  const destination = path.join(targetRoot, "skills", "code-review");
  assert.equal((await lstat(destination)).isSymbolicLink(), true);
  assert.match(await readFile(path.join(destination, "SKILL.md"), "utf8"), /code-review/);
  assert.equal(await readFile(path.join(destination, "reference.md"), "utf8"), "reference material\n");

  await uninstallFormula(home, "code-review");
  await assert.rejects(lstat(destination), /ENOENT/);
});

test("workflow and prompt formulas project to target-native skills", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-targets-"));
  const home = path.join(root, "home");
  const claudeRoot = path.join(root, ".claude");
  const codexRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "workflows", "release", { targets: ["claude-code"] });
  await addFormula(repository, "prompts", "summarize", { targets: ["openai-codex"] });
  await addTap(home, "personal/agents", repository);

  await installForTarget(home, "release", "claude-code", { root: claudeRoot });
  await installForTarget(home, "summarize", "openai-codex", { root: codexRoot });
  const workflowSkill = path.join(claudeRoot, "skills", "release", "SKILL.md");
  const promptSkill = path.join(codexRoot, "skills", "summarize", "SKILL.md");
  assert.equal((await lstat(workflowSkill)).isSymbolicLink(), false);
  assert.match(await readFile(workflowSkill, "utf8"), /name: release[\s\S]*kind: workflow/u);
  assert.match(await readFile(promptSkill, "utf8"), /name: summarize[\s\S]*kind: prompt/u);
});

test("Claude adapter links complete skill directories", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-targets-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".claude");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "review", { targets: ["claude-code"], entry: "SKILL.md" });
  await writeFile(path.join(repository, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Review changes\n---\n");
  await mkdir(path.join(repository, "skills", "review", "scripts"));
  await writeFile(path.join(repository, "skills", "review", "scripts", "check.sh"), "echo checked\n");
  await git(repository, "add", "skills/review");
  await git(repository, "commit", "-m", "complete review skill");
  await addTap(home, "personal/agents", repository);

  await installForTarget(home, "review", "claude-code", { root: targetRoot });
  const destination = path.join(targetRoot, "skills", "review");
  assert.equal((await lstat(destination)).isSymbolicLink(), true);
  assert.equal(await readFile(path.join(destination, "scripts", "check.sh"), "utf8"), "echo checked\n");
});

test("skill linking validates the canonical SKILL.md metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-targets-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "invalid-skill");
  await writeFile(path.join(repository, "skills", "invalid-skill", "SKILL.md"), "# Missing frontmatter\n");
  await git(repository, "add", "skills/invalid-skill/SKILL.md");
  await git(repository, "commit", "-m", "break skill metadata");
  await addTap(home, "personal/agents", repository);
  await installFormula(home, "invalid-skill");

  await assert.rejects(
    linkFormula(home, "invalid-skill", "openai-codex", { root: targetRoot }),
    /YAML frontmatter/
  );
});

test("agent formulas render native Codex TOML and Claude Code Markdown", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-targets-"));
  const home = path.join(root, "home");
  const codexRoot = path.join(root, ".codex");
  const claudeRoot = path.join(root, ".claude");
  const repository = await createTapRepository(root);
  await addFormula(repository, "agents", "reviewer", {
    description: "Reviews risky changes",
    targets: ["openai-codex", "claude-code"]
  });
  await addTap(home, "personal/agents", repository);

  await installForTarget(home, "reviewer", "openai-codex", { root: codexRoot });
  await linkFormula(home, "reviewer", "claude-code", { root: claudeRoot });
  const codexAgent = path.join(codexRoot, "agents", "reviewer.toml");
  const claudeAgent = path.join(claudeRoot, "agents", "reviewer.md");
  assert.equal((await lstat(codexAgent)).isSymbolicLink(), false);
  assert.match(await readFile(codexAgent, "utf8"), /description = "Reviews risky changes"/);
  assert.match(await readFile(codexAgent, "utf8"), /developer_instructions = "# reviewer\\n"/);
  assert.match(await readFile(claudeAgent, "utf8"), /^---\nname: reviewer\ndescription: Reviews risky changes\n---/u);

  await writeFile(codexAgent, "user replacement\n");
  await assert.rejects(unlinkFormula(home, "reviewer", "openai-codex"), /modified/);
});

test("instructions use Codex managed blocks and Claude Code rule links", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-targets-"));
  const home = path.join(root, "home");
  const codexRoot = path.join(root, ".codex");
  const claudeRoot = path.join(root, ".claude");
  const repository = await createTapRepository(root);
  await addFormula(repository, "instructions", "security", {
    targets: ["openai-codex", "claude-code"]
  });
  await addFormula(repository, "instructions", "style", {
    targets: ["openai-codex"]
  });
  await addTap(home, "personal/agents", repository);
  await mkdir(codexRoot, { recursive: true });
  const agentsFile = path.join(codexRoot, "AGENTS.md");
  await writeFile(agentsFile, "# User-owned instructions\nPreserve this.\n");

  await installForTarget(home, "security", "openai-codex", { root: codexRoot });
  await installForTarget(home, "style", "openai-codex", { root: codexRoot });
  await linkFormula(home, "security", "claude-code", { root: claudeRoot });
  const installedContent = await readFile(agentsFile, "utf8");
  assert.match(installedContent, /# User-owned instructions/u);
  assert.match(installedContent, /harnessbrew:start personal\/agents\/security/u);
  assert.match(installedContent, /harnessbrew:start personal\/agents\/style/u);
  const claudeRule = path.join(claudeRoot, "rules", "security.md");
  assert.equal((await lstat(claudeRule)).isSymbolicLink(), true);

  await unlinkFormula(home, "security", "openai-codex");
  const afterUnlink = await readFile(agentsFile, "utf8");
  assert.match(afterUnlink, /# User-owned instructions/u);
  assert.doesNotMatch(afterUnlink, /personal\/agents\/security/u);
  assert.match(afterUnlink, /personal\/agents\/style/u);

  await writeFile(agentsFile, afterUnlink.replace("# style", "# user-edited style"));
  await assert.rejects(unlinkFormula(home, "style", "openai-codex"), /modified/);
});

test("linking rejects unowned target files and uninstall detects link replacement", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-targets-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "code-review");
  await addTap(home, "personal/agents", repository);
  await installFormula(home, "code-review");

  const destination = path.join(targetRoot, "skills", "code-review");
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, "SKILL.md"), "user content\n", "utf8");
  await assert.rejects(linkFormula(home, "code-review", "openai-codex", { root: targetRoot }), /not managed/);

  await rm(destination, { recursive: true });
  await linkFormula(home, "code-review", "openai-codex", { root: targetRoot });
  await rm(destination);
  await mkdir(destination);
  await writeFile(path.join(destination, "replacement.md"), "replacement\n", "utf8");
  await assert.rejects(uninstallFormula(home, "code-review"), /Installed target was modified/);
  assert.equal((await listInstalled(home)).length, 1);
});
