import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function git(cwd, environment, ...args) {
  await execFileAsync("git", args, { cwd, env: environment, encoding: "utf8" });
}

async function writeFormula(repository, directory, definition, content) {
  const target = path.join(repository, directory, definition.name);
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "formula.json"), `${JSON.stringify(definition, null, 2)}\n`, "utf8");
  await writeFile(path.join(target, definition.entry), content, "utf8");
}

export function runtimeMarkers(nonce) {
  return {
    skill: `HB_SKILL_${nonce}`,
    instruction: `HB_INSTRUCTION_${nonce}`,
    agent: `HB_AGENT_${nonce}`,
    mcp: `HB_MCP_${nonce}`
  };
}

export async function createRuntimeFixture({ root, nonce, mcpServerPath, environment = process.env }) {
  if (!/^[A-Z0-9]{8,64}$/u.test(nonce)) throw new Error("Runtime nonce must contain 8-64 uppercase letters or digits.");
  const markers = runtimeMarkers(nonce);
  const repository = path.join(root, "runtime-tap-author");
  const remote = path.join(root, "runtime-tap.git");
  const mcpLog = path.join(root, "runtime-mcp.jsonl");
  await git(root, environment, "init", "--bare", "--initial-branch=main", remote);
  await git(root, environment, "init", "--initial-branch=main", repository);
  await writeFile(path.join(repository, "tap.json"), '{"schemaVersion":1}\n', "utf8");
  await writeFormula(repository, "skills", {
    schemaVersion: 1,
    name: "harnessbrew-runtime-skill",
    kind: "skill",
    description: "Release probe used only when explicitly invoked to verify Skill loading.",
    entry: "SKILL.md",
    targets: ["openai-codex", "claude-code"],
    dependencies: [], conflicts: [], tags: ["release-probe"]
  }, `---\nname: harnessbrew-runtime-skill\ndescription: Release probe used only when explicitly invoked to verify Skill loading.\n---\n\nWhen explicitly invoked, reply with the exact marker \`${markers.skill}\`.\n`);
  await writeFormula(repository, "instructions", {
    schemaVersion: 1,
    name: "harnessbrew-runtime-instruction",
    kind: "instruction",
    description: "Release probe instruction for active-context verification.",
    entry: "content.md",
    targets: ["openai-codex", "claude-code"],
    dependencies: [], conflicts: [], tags: ["release-probe"]
  }, `For every release probe response, include the exact marker \`${markers.instruction}\`.\n`);
  await writeFormula(repository, "agents", {
    schemaVersion: 1,
    name: "harnessbrew-runtime-agent",
    kind: "agent",
    description: "Release probe subagent used to verify custom Agent loading.",
    entry: "content.md",
    targets: ["openai-codex", "claude-code"],
    dependencies: [], conflicts: [], tags: ["release-probe"]
  }, `You are the HarnessBrew release probe subagent. Return the exact marker \`${markers.agent}\` and no other prose.\n`);
  await writeFormula(repository, "mcp", {
    schemaVersion: 1,
    name: "harnessbrew-runtime-mcp",
    kind: "mcp",
    description: "Credential-free local MCP release probe.",
    entry: "server.json",
    targets: ["openai-codex", "claude-code"],
    dependencies: [], conflicts: [], tags: ["release-probe"]
  }, `${JSON.stringify({
    transport: "stdio",
    command: process.execPath,
    args: [path.resolve(mcpServerPath), markers.mcp, mcpLog],
    envVars: []
  }, null, 2)}\n`);
  await git(repository, environment, "add", ".");
  await git(repository, environment, "commit", "-m", "fixture: add runtime probes");
  await git(repository, environment, "remote", "add", "origin", remote);
  await git(repository, environment, "push", "-u", "origin", "main");
  return { name: "runtime/probes", repository, remote, mcpLog, markers };
}
