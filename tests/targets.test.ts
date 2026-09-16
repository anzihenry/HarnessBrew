import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { installFormula, listInstalled, uninstallFormula, writeReceipt } from "../src/core/installations.js";
import { doctor } from "../src/core/doctor.js";
import { getTargetAdapter, listTargetAdapters } from "../src/core/targets/registry.js";
import { executeTargetOperations } from "../src/core/targets/transaction.js";
import { addTap, setTapTrust } from "../src/core/taps.js";
import { installForTarget, linkFormula, unlinkFormula } from "../src/core/targets.js";
import { addFormula, createTapRepository, git } from "./helpers/git.js";

test("only Codex is built in; retired Target receipts remain diagnosable and removable", async () => {
  assert.deepEqual(listTargetAdapters().map((adapter) => adapter.name), ["openai-codex"]);
  assert.throws(() => getTargetAdapter("claude-code"), /not registered/u);
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-retired-target-"));
  try {
    const home = path.join(root, "home");
    const repository = await createTapRepository(root);
    await addFormula(repository, "mcp", "docs", { targets: ["claude-code"] });
    await addTap(home, "personal/agents", repository, { trust: true });
    const [receipt] = await installFormula(home, "docs");
    assert.ok(receipt);
    const destination = path.join(root, ".mcp.json");
    const userConfig = { theme: "dark", mcpServers: { user: { command: "user-server" } } };
    await writeFile(destination, JSON.stringify(userConfig));
    receipt.operations = await executeTargetOperations([{
      id: "legacy-mcp",
      type: "merge-config",
      target: "claude-code",
      destination,
      configFormat: "json",
      ownedKeys: ["mcpServers", "docs"],
      content: JSON.stringify({ command: "docs-server" })
    }]);
    receipt.targets = ["claude-code"];
    await writeReceipt(home, receipt);
    assert.equal((await doctor(home)).healthy, true);
    await uninstallFormula(home, "docs");
    assert.deepEqual(JSON.parse(await readFile(destination, "utf8")), userConfig);
    assert.deepEqual(await listInstalled(home), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("untrusted taps can populate the Cellar but cannot activate Targets", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-targets-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "review");
  const tap = await addTap(home, "personal/agents", repository);
  assert.equal(tap.trusted, false);
  await installFormula(home, "review");

  await assert.rejects(linkFormula(home, "review", "openai-codex", { root: targetRoot }), /Tap is not trusted/u);
  await setTapTrust(home, "personal/agents", true);
  const linked = await linkFormula(home, "review", "openai-codex", { root: targetRoot });
  assert.equal(linked.operations.length, 1);
});

test("Codex adapter links skill entries and uninstall removes owned links", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-targets-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "code-review");
  await writeFile(path.join(repository, "skills", "code-review", "reference.md"), "reference material\n");
  await git(repository, "add", "skills/code-review/reference.md");
  await git(repository, "commit", "-m", "add skill reference");
  await addTap(home, "personal/agents", repository, { trust: true });

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
  const codexRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "workflows", "release", { targets: ["openai-codex"] });
  await addFormula(repository, "prompts", "summarize", { targets: ["openai-codex"] });
  await addTap(home, "personal/agents", repository, { trust: true });

  await installForTarget(home, "release", "openai-codex", { root: codexRoot });
  await installForTarget(home, "summarize", "openai-codex", { root: codexRoot });
  const workflowSkill = path.join(codexRoot, "skills", "release", "SKILL.md");
  const promptSkill = path.join(codexRoot, "skills", "summarize", "SKILL.md");
  assert.equal((await lstat(workflowSkill)).isSymbolicLink(), false);
  assert.match(await readFile(workflowSkill, "utf8"), /name: release[\s\S]*kind: workflow/u);
  assert.match(await readFile(promptSkill, "utf8"), /name: summarize[\s\S]*kind: prompt/u);
});

test("Codex adapter links complete skill directories", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-targets-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "review", { targets: ["openai-codex"], entry: "SKILL.md" });
  await writeFile(path.join(repository, "skills", "review", "SKILL.md"), "---\nname: review\ndescription: Review changes\n---\n");
  await mkdir(path.join(repository, "skills", "review", "scripts"));
  await writeFile(path.join(repository, "skills", "review", "scripts", "check.sh"), "echo checked\n");
  await git(repository, "add", "skills/review");
  await git(repository, "commit", "-m", "complete review skill");
  await addTap(home, "personal/agents", repository, { trust: true });

  await installForTarget(home, "review", "openai-codex", { root: targetRoot });
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
  await addTap(home, "personal/agents", repository, { trust: true });
  await installFormula(home, "invalid-skill");

  await assert.rejects(
    linkFormula(home, "invalid-skill", "openai-codex", { root: targetRoot }),
    /YAML frontmatter/
  );
});

test("agent formulas render native Codex TOML", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-targets-"));
  const home = path.join(root, "home");
  const codexRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "agents", "reviewer", {
    description: "Reviews risky changes",
    targets: ["openai-codex"]
  });
  await addTap(home, "personal/agents", repository, { trust: true });

  await installForTarget(home, "reviewer", "openai-codex", { root: codexRoot });
  const codexAgent = path.join(codexRoot, "agents", "reviewer.toml");
  assert.equal((await lstat(codexAgent)).isSymbolicLink(), false);
  assert.match(await readFile(codexAgent, "utf8"), /description = "Reviews risky changes"/);
  assert.match(await readFile(codexAgent, "utf8"), /developer_instructions = "# reviewer\\n"/);

  await writeFile(codexAgent, "user replacement\n");
  await assert.rejects(unlinkFormula(home, "reviewer", "openai-codex"), /modified/);
});

test("instructions use Codex managed blocks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-targets-"));
  const home = path.join(root, "home");
  const codexRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "instructions", "security", {
    targets: ["openai-codex"]
  });
  await addFormula(repository, "instructions", "style", {
    targets: ["openai-codex"]
  });
  await addTap(home, "personal/agents", repository, { trust: true });
  await mkdir(codexRoot, { recursive: true });
  const agentsFile = path.join(codexRoot, "AGENTS.md");
  await writeFile(agentsFile, "# User-owned instructions\nPreserve this.\n");

  await installForTarget(home, "security", "openai-codex", { root: codexRoot });
  await installForTarget(home, "style", "openai-codex", { root: codexRoot });
  const installedContent = await readFile(agentsFile, "utf8");
  assert.match(installedContent, /# User-owned instructions/u);
  assert.match(installedContent, /harnessbrew:start personal\/agents\/security/u);
  assert.match(installedContent, /harnessbrew:start personal\/agents\/style/u);

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
  const repository = await createTapRepository(root);
  await addFormula(repository, "mcp", "docs", { targets: ["openai-codex"] });
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
  await addTap(home, "personal/agents", repository, { trust: true });
  await mkdir(codexRoot, { recursive: true });
  const codexConfig = path.join(codexRoot, "config.toml");
  await writeFile(codexConfig, "model = \"gpt-5\"\n");

  await installForTarget(home, "docs", "openai-codex", { root: codexRoot });
  const codexContent = await readFile(codexConfig, "utf8");
  assert.match(codexContent, /model = "gpt-5"/u);
  assert.match(codexContent, /\[mcp_servers\.docs\][\s\S]*env_vars = \["DOCS_TOKEN"\]/u);

  await unlinkFormula(home, "docs", "openai-codex");
  assert.equal(await readFile(codexConfig, "utf8"), "model = \"gpt-5\"\n");
  await installForTarget(home, "remote", "openai-codex", { root: codexRoot });
  assert.match(await readFile(codexConfig, "utf8"), /bearer_token_env_var = "MCP_TOKEN"[\s\S]*env_http_headers = \{ "X-Tenant" = "MCP_TENANT" \}/u);
  await unlinkFormula(home, "remote", "openai-codex");

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
  await addTap(home, "personal/agents", repository, { trust: true });
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
    targets: ["openai-codex"]
  });
  await addTap(home, "personal/agents", repository, { trust: true });

  const [receipt] = await installFormula(home, "custom-target");
  assert.equal(receipt?.kind, "adapter");
  assert.equal((await listInstalled(home)).length, 1);
  await assert.rejects(
    linkFormula(home, "custom-target", "openai-codex", { root: path.join(root, ".codex") }),
    /cannot be linked.*install it to the Cellar without --target/u
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
  await addTap(home, "personal/agents", repository, { trust: true });
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
