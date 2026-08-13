import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

interface FixtureModule {
  createRuntimeFixture(options: {
    root: string; nonce: string; mcpServerPath: string; environment?: NodeJS.ProcessEnv;
  }): Promise<{ repository: string; remote: string; mcpLog: string; markers: Record<string, string> }>;
}

const fixtureModule = await import(pathToFileURL(path.resolve("scripts/runtime/fixture.mjs")).href) as FixtureModule;

test("runtime fixture creates nonce-bearing Skill, Instruction, Agent, and MCP formulas", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-runtime-fixture-"));
  const nonce = "ABCDEF123456";
  const fixture = await fixtureModule.createRuntimeFixture({
    root,
    nonce,
    mcpServerPath: path.resolve("scripts/runtime/mcp-fixture.mjs")
  });
  assert.match(await readFile(path.join(fixture.repository, "skills", "harnessbrew-runtime-skill", "SKILL.md"), "utf8"),
    new RegExp(fixture.markers.skill as string, "u"));
  assert.match(await readFile(path.join(fixture.repository, "instructions", "harnessbrew-runtime-instruction", "content.md"), "utf8"),
    new RegExp(fixture.markers.instruction as string, "u"));
  assert.match(await readFile(path.join(fixture.repository, "agents", "harnessbrew-runtime-agent", "content.md"), "utf8"),
    new RegExp(fixture.markers.agent as string, "u"));
  assert.match(await readFile(path.join(fixture.repository, "mcp", "harnessbrew-runtime-mcp", "server.json"), "utf8"),
    new RegExp(fixture.markers.mcp as string, "u"));
});

test("runtime MCP fixture exposes and records its nonce tool", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-runtime-mcp-"));
  const log = path.join(root, "mcp.jsonl");
  const marker = "HB_MCP_ABCDEF123456";
  const child = spawn(process.execPath, [path.resolve("scripts/runtime/mcp-fixture.mjs"), marker, log], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  const responses: unknown[] = [];
  let buffered = "";
  child.stdout.on("data", (chunk) => {
    buffered += chunk.toString("utf8");
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) if (line !== "") responses.push(JSON.parse(line));
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "harnessbrew_runtime_nonce", arguments: {} } })}\n`);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("MCP fixture timed out")), 3_000);
    const poll = setInterval(() => {
      if (responses.length >= 3) {
        clearTimeout(timeout);
        clearInterval(poll);
        resolve();
      }
    }, 10);
  });
  child.kill("SIGTERM");
  assert.equal((responses[2] as { result: { content: Array<{ text: string }> } }).result.content[0]?.text, marker);
  assert.match(await readFile(log, "utf8"), /"event":"tool-called"/u);
  assert.match(await readFile(log, "utf8"), new RegExp(marker, "u"));
});
