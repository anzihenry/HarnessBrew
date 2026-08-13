import assert from "node:assert/strict";
import { lstat, mkdir, readFile, readlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertFailedEnvelope, assertPathMissing, assertSuccessfulEnvelope, readJsonFile } from "../assertions.mjs";
import { createTapFixture } from "../fixture-tap.mjs";

const deliverables = [
  { kind: "skill", name: "main-skill", operation: "symlink-directory" },
  { kind: "agent", name: "runtime-agent", operation: "render-file" },
  { kind: "workflow", name: "runtime-workflow", operation: "render-file" },
  { kind: "instruction", name: "runtime-instruction", codexOperation: "managed-block", claudeOperation: "symlink-file" },
  { kind: "prompt", name: "runtime-prompt", operation: "render-file" },
  { kind: "mcp", name: "runtime-mcp", operation: "merge-config" }
];

function destination(environment, formula, target, scope) {
  const project = environment.paths.project;
  if (target === "openai-codex") {
    const root = scope === "user" ? environment.paths.codexRoot : path.join(project, ".codex");
    switch (formula.kind) {
      case "skill": return scope === "user"
        ? path.join(root, "skills", formula.name)
        : path.join(project, ".agents", "skills", formula.name);
      case "workflow":
      case "prompt": return scope === "user"
        ? path.join(root, "skills", formula.name, "SKILL.md")
        : path.join(project, ".agents", "skills", formula.name, "SKILL.md");
      case "agent": return path.join(root, "agents", `${formula.name}.toml`);
      case "instruction": return scope === "user" ? path.join(root, "AGENTS.md") : path.join(project, "AGENTS.md");
      case "mcp": return path.join(root, "config.toml");
    }
  }
  const root = scope === "user" ? environment.paths.claudeRoot : path.join(project, ".claude");
  switch (formula.kind) {
    case "skill": return path.join(root, "skills", formula.name);
    case "workflow":
    case "prompt": return path.join(root, "skills", formula.name, "SKILL.md");
    case "agent": return path.join(root, "agents", `${formula.name}.md`);
    case "instruction": return path.join(root, "rules", `${formula.name}.md`);
    case "mcp": return scope === "user" ? path.join(root, ".mcp.json") : path.join(project, ".mcp.json");
  }
}

function placementArgs(environment, target, scope) {
  return scope === "user"
    ? ["--scope", "user", "--target-root", target === "openai-codex" ? environment.paths.codexRoot : environment.paths.claudeRoot]
    : ["--scope", "project", "--project", environment.paths.project];
}

async function verifyDestination(formula, target, candidate) {
  const metadata = await lstat(candidate);
  if (formula.kind === "skill" || (formula.kind === "instruction" && target === "claude-code")) {
    assert.equal(metadata.isSymbolicLink(), true, `${formula.kind}/${target} must be a symbolic link`);
    const linked = path.resolve(path.dirname(candidate), await readlink(candidate));
    assert.match(linked, /harnessbrew-home[\/]cellar/u);
    if (formula.kind === "skill") {
      assert.match(await readFile(path.join(candidate, "references", "version.txt"), "utf8"), /v1/u);
    }
    return;
  }
  assert.equal(metadata.isFile(), true, `${formula.kind}/${target} must be a file`);
  const content = await readFile(candidate, "utf8");
  if (formula.kind === "agent") {
    if (target === "openai-codex") assert.match(content, /developer_instructions\s*=/u);
    else assert.match(content, /^---\nname: runtime-agent/mu);
  }
  if (formula.kind === "workflow" || formula.kind === "prompt") {
    assert.match(content, new RegExp(`kind: ${formula.kind}`, "u"));
  }
  if (formula.kind === "instruction" && target === "openai-codex") {
    assert.match(content, /<!-- harnessbrew:start e2e\/assets\/runtime-instruction -->/u);
  }
  if (formula.kind === "mcp") {
    if (target === "openai-codex") assert.match(content, /\[mcp_servers\.runtime-mcp\]/u);
    else assert.equal(JSON.parse(content).mcpServers["runtime-mcp"].command, "node");
  }
}

export async function targetMatrixScenario({ environment, cli }) {
  const fixture = await createTapFixture(environment, { id: "target-matrix" });
  assertSuccessfulEnvelope((await cli.runJson(["tap", "add", fixture.name, fixture.remote, "--trust"])).envelope, "tap");

  const preservedFiles = new Map([
    [path.join(environment.paths.codexRoot, "AGENTS.md"), "# User Codex instructions\n"],
    [path.join(environment.paths.project, "AGENTS.md"), "# Project instructions\n"],
    [path.join(environment.paths.codexRoot, "config.toml"), 'model = "user-model"\n'],
    [path.join(environment.paths.project, ".codex", "config.toml"), 'model = "project-model"\n'],
    [path.join(environment.paths.claudeRoot, ".mcp.json"), `${JSON.stringify({ userSetting: true, mcpServers: {} }, null, 2)}\n`],
    [path.join(environment.paths.project, ".mcp.json"), `${JSON.stringify({ projectSetting: true, mcpServers: {} }, null, 2)}\n`]
  ]);
  for (const [candidate, content] of preservedFiles) {
    await mkdir(path.dirname(candidate), { recursive: true });
    await writeFile(candidate, content, "utf8");
  }

  const targets = ["openai-codex", "claude-code"];
  const scopes = ["user", "project"];
  for (const formula of deliverables) {
    assertSuccessfulEnvelope((await cli.runJson(["install", formula.name])).envelope, "install");
    for (const target of targets) {
      for (const scope of scopes) {
        const linked = await cli.runJson([
          "link", formula.name, "--target", target, ...placementArgs(environment, target, scope)
        ]);
        assertSuccessfulEnvelope(linked.envelope, "link");
        await verifyDestination(formula, target, destination(environment, formula, target, scope));
      }
    }
    const receipt = await readJsonFile(path.join(
      environment.paths.harnessHome, "receipts", "e2e", "assets", `${formula.name}.json`
    ));
    assert.equal(receipt.operations.length, 4, `${formula.kind} should record four placements`);
    assert.deepEqual([...new Set(receipt.operations.map((operation) => operation.target))].sort(), targets.slice().sort());
    for (const operation of receipt.operations) {
      const expected = formula.kind === "instruction"
        ? operation.target === "openai-codex" ? formula.codexOperation : formula.claudeOperation
        : formula.operation;
      assert.equal(operation.type, expected);
    }
  }

  const doctor = await cli.runJson(["doctor"]);
  assertSuccessfulEnvelope(doctor.envelope, "doctor");
  assert.equal(doctor.envelope.result.healthy, true);

  const ambiguous = await cli.runJson(["unlink", "main-skill", "--target", "openai-codex"], { expectExitCode: 1 });
  assertFailedEnvelope(ambiguous.envelope, "unlink", /multiple installations|scope|ambiguous/iu);

  assertSuccessfulEnvelope((await cli.runJson(["install", "runtime-adapter"])).envelope, "install");
  for (const target of targets) {
    const unsupported = await cli.runJson([
      "link", "runtime-adapter", "--target", target, ...placementArgs(environment, target, "project")
    ], { expectExitCode: 1 });
    assertFailedEnvelope(unsupported.envelope, "link", /cannot be linked/u);
  }

  for (const formula of deliverables) {
    for (const target of targets) {
      for (const scope of scopes) {
        assertSuccessfulEnvelope((await cli.runJson([
          "unlink", formula.name, "--target", target, ...placementArgs(environment, target, scope)
        ])).envelope, "unlink");
        if (!(formula.kind === "instruction" && target === "openai-codex") && formula.kind !== "mcp") {
          await assertPathMissing(destination(environment, formula, target, scope));
        }
      }
    }
    assertSuccessfulEnvelope((await cli.runJson(["uninstall", formula.name])).envelope, "uninstall");
  }
  assertSuccessfulEnvelope((await cli.runJson(["uninstall", "helper-skill"])).envelope, "uninstall");
  assertSuccessfulEnvelope((await cli.runJson(["uninstall", "runtime-adapter"])).envelope, "uninstall");

  for (const [candidate, original] of preservedFiles) {
    assert.equal(await readFile(candidate, "utf8"), original, `user content changed after cleanup: ${candidate}`);
  }
  assertSuccessfulEnvelope((await cli.runJson(["untap", fixture.name])).envelope, "untap");
  assert.deepEqual((await cli.runJson(["list"])).envelope.result, []);

  return { placements: deliverables.length * targets.length * scopes.length };
}
