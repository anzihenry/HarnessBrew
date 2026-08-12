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

test("MCP formulas merge owned config while preserving user settings", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-targets-"));
  const home = path.join(root, "home");
  const codexRoot = path.join(root, ".codex");
  const claudeRoot = path.join(root, ".claude");
  const repository = await createTapRepository(root);
  await addFormula(repository, "mcp", "docs", { targets: ["openai-codex", "claude-code"] });
  await addFormula(repository, "mcp", "remote", { targets: ["openai-codex"] });
  await addFormula(repository, "mcp", "unsafe", { targets: ["openai-codex"] });
  await writeFile(path.join(repository, "mcp", "docs", "content.md"), JSON.stringify({
    transport: "stdio",
    command: "npx",
    args: ["-y", "docs-server"],
    envVars: ["DOCS_TOKEN"]
  }));
  await git(repository, "add", "mcp/docs/content.md");
  await git(repository, "commit", "-m", "define docs mcp");
  await writeFile(path.join(repository, "mcp", "remote", "content.md"), JSON.stringify({
    transport: "http",
    url: "https://mcp.example.test",
    bearerTokenEnvVar: "MCP_TOKEN",
    headersFromEnv: { "X-Tenant": "MCP_TENANT" }
  }));
  await git(repository, "add", "mcp/remote/content.md");
  await git(repository, "commit", "-m", "define remote mcp");
  await writeFile(path.join(repository, "mcp", "unsafe", "content.md"), JSON.stringify({
    command: "unsafe-server",
    env: { TOKEN: "plaintext-secret" }
  }));
  await git(repository, "add", "mcp/unsafe/content.md");
  await git(repository, "commit", "-m", "define unsafe mcp");
  await addTap(home, "personal/agents", repository);
  await mkdir(codexRoot, { recursive: true });
  await mkdir(claudeRoot, { recursive: true });
  const codexConfig = path.join(codexRoot, "config.toml");
  const claudeConfig = path.join(claudeRoot, ".mcp.json");
  await writeFile(codexConfig, "model = \"gpt-5\"\n");
  await writeFile(claudeConfig, `${JSON.stringify({ theme: "dark" }, null, 2)}\n`);

  await installForTarget(home, "docs", "openai-codex", { root: codexRoot });
  await linkFormula(home, "docs", "claude-code", { root: claudeRoot });
  const codexContent = await readFile(codexConfig, "utf8");
  assert.match(codexContent, /model = "gpt-5"/u);
  assert.match(codexContent, /\[mcp_servers\.docs\][\s\S]*env_vars = \["DOCS_TOKEN"\]/u);
  const claudeContent = JSON.parse(await readFile(claudeConfig, "utf8")) as {
    theme: string;
    mcpServers: Record<string, { env: Record<string, string> }>;
  };
  assert.equal(claudeContent.theme, "dark");
  const docsServer = claudeContent.mcpServers.docs;
  assert.ok(docsServer);
  assert.equal(docsServer.env.DOCS_TOKEN, "${DOCS_TOKEN}");

  await unlinkFormula(home, "docs", "openai-codex");
  assert.equal(await readFile(codexConfig, "utf8"), "model = \"gpt-5\"\n");
  await installForTarget(home, "remote", "openai-codex", { root: codexRoot });
  assert.match(await readFile(codexConfig, "utf8"), /bearer_token_env_var = "MCP_TOKEN"[\s\S]*env_http_headers = \{ "X-Tenant" = "MCP_TENANT" \}/u);
  await unlinkFormula(home, "remote", "openai-codex");
  docsServer.env.DOCS_TOKEN = "plaintext-secret";
  await writeFile(claudeConfig, `${JSON.stringify(claudeContent, null, 2)}\n`);
  await assert.rejects(unlinkFormula(home, "docs", "claude-code"), /modified/);

  await installFormula(home, "unsafe");
  await assert.rejects(
    linkFormula(home, "unsafe", "openai-codex", { root: codexRoot }),
    /use command, args, and envVars/
  );
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

test("adapter formulas install to the Cellar but cannot link to Agent targets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-targets-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);
  await addFormula(repository, "adapters", "custom-target", {
    targets: ["openai-codex", "claude-code"]
  });
  await addTap(home, "personal/agents", repository);

  const [receipt] = await installFormula(home, "custom-target");
  assert.equal(receipt?.kind, "adapter");
  assert.equal((await listInstalled(home)).length, 1);
  await assert.rejects(
    linkFormula(home, "custom-target", "openai-codex", { root: path.join(root, ".codex") }),
    /cannot be linked.*install it to the Cellar without --target/u
  );
  await assert.rejects(
    linkFormula(home, "custom-target", "claude-code", { root: path.join(root, ".claude") }),
    /cannot be linked/u
  );
  assert.equal((await listInstalled(home))[0]?.operations.length, 0);
});

test("one formula can link to user and project scopes independently", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-targets-"));
  const home = path.join(root, "home");
  const userRoot = path.join(root, "user-codex");
  const projectRoot = path.join(root, "project");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "review");
  await addTap(home, "personal/agents", repository);
  await installFormula(home, "review");

  await linkFormula(home, "review", "openai-codex", { scope: "user", root: userRoot });
  const linked = await linkFormula(home, "review", "openai-codex", { scope: "project", projectRoot });
  const userDestination = path.join(userRoot, "skills", "review");
  const projectDestination = path.join(projectRoot, ".agents", "skills", "review");
  assert.equal((await lstat(userDestination)).isSymbolicLink(), true);
  assert.equal((await lstat(projectDestination)).isSymbolicLink(), true);
  assert.equal(linked.operations.length, 2);
  assert.deepEqual(linked.operations.map((operation) => operation.scope).sort(), ["project", "user"]);
  await assert.rejects(
    unlinkFormula(home, "review", "openai-codex"),
    /multiple openai-codex installations.*specify --scope/u
  );

  const afterProjectUnlink = await unlinkFormula(home, "review", "openai-codex", {
    scope: "project",
    projectRoot
  });
  await assert.rejects(lstat(projectDestination), /ENOENT/);
  assert.equal((await lstat(userDestination)).isSymbolicLink(), true);
  assert.equal(afterProjectUnlink.operations.length, 1);
  assert.deepEqual(afterProjectUnlink.targets, ["openai-codex"]);
});
