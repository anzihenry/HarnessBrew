import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

interface ClaudeModule {
  parseClaudeStreamJson(stdout: string): Array<Record<string, unknown>>;
  classifyClaudeFailure(text: string, state?: { timedOut?: boolean }): { failureClass: string };
  runClaudeProbe(options: Record<string, unknown>): Promise<Record<string, unknown>>;
}
const claudeModule = await import(pathToFileURL(path.resolve("scripts/runtime/claude.mjs")).href) as ClaudeModule;

async function fakeClaude(root: string): Promise<string> {
  const script = path.join(root, "fake-claude.mjs");
  await writeFile(script, `
    const prompt = process.argv.find((argument) => /AUTH_FAILURE|MCP_EVENT|OMIT_MARKER/.test(argument)) ?? "";
    if (prompt.includes("AUTH_FAILURE")) {
      console.error("OAuth authentication required; run login");
      process.exit(1);
    }
    console.log(JSON.stringify({ type: "system", subtype: "init", tools: [] }));
    if (prompt.includes("MCP_EVENT")) console.log(JSON.stringify({
      type: "assistant",
      message: { content: [{
        type: "tool_use",
        name: "mcp__harnessbrew-runtime-mcp__harnessbrew_runtime_nonce",
        input: {}
      }] }
    }));
    console.log(JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: prompt.includes("OMIT_MARKER") ? "no marker" : "HB_SKILL_TESTMARK"
    }));
  `, "utf8");
  return script;
}

async function recordingClaude(root: string, argumentsPath: string): Promise<string> {
  const script = path.join(root, "recording-claude.mjs");
  await writeFile(script, `
    import { writeFile } from "node:fs/promises";
    await writeFile(${JSON.stringify(argumentsPath)}, JSON.stringify(process.argv.slice(2)));
    console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "HB_SKILL_TESTMARK" }));
  `, "utf8");
  return script;
}

test("Claude runtime adapter parses stream JSON and requires final-result plus tool evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-runtime-claude-"));
  const script = await fakeClaude(root);
  const passed = await claudeModule.runClaudeProbe({
    probe: {
      name: "mcp",
      prompt: "MCP_EVENT",
      marker: "HB_SKILL_TESTMARK",
      requiredEvent: {
        toolNameIncludes: "harnessbrew_runtime_nonce",
        textIncludes: "harnessbrew-runtime-mcp"
      }
    },
    cwd: root,
    binary: process.execPath,
    prefixArgs: [script]
  });
  assert.equal(passed.status, "passed");
  assert.equal(passed.markerObserved, true);
  assert.equal(passed.requiredEventObserved, true);
  assert.deepEqual((passed.evidence as { toolCalls: unknown[] }).toolCalls, [
    { name: "mcp__harnessbrew-runtime-mcp__harnessbrew_runtime_nonce" }
  ]);

  const missing = await claudeModule.runClaudeProbe({
    probe: { name: "skill", prompt: "OMIT_MARKER", marker: "HB_SKILL_TESTMARK" },
    cwd: root,
    binary: process.execPath,
    prefixArgs: [script]
  });
  assert.equal(missing.failureClass, "behavioral-failure");
});

test("Claude runtime adapter classifies authentication and provider failures without exposing output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-runtime-claude-"));
  const script = await fakeClaude(root);
  const auth = await claudeModule.runClaudeProbe({
    probe: { name: "skill", prompt: "AUTH_FAILURE", marker: "HB_SKILL_TESTMARK" },
    cwd: root,
    binary: process.execPath,
    prefixArgs: [script]
  });
  assert.equal(auth.failureClass, "environment-failure");
  assert.equal("stdout" in auth, false);
  assert.equal("stderr" in auth, false);
  assert.equal(claudeModule.classifyClaudeFailure("service unavailable 503").failureClass, "provider-failure");
  assert.throws(() => claudeModule.parseClaudeStreamJson("not-json\n"), /invalid stream JSON/u);
});

test("Claude runtime adapter passes the prompt separately from the variadic allowed-tools option", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-runtime-claude-args-"));
  const argumentsPath = path.join(root, "arguments.json");
  const script = await recordingClaude(root, argumentsPath);
  const prompt = "PROMPT_IS_A_POSITIONAL_ARGUMENT";
  const result = await claudeModule.runClaudeProbe({
    probe: { name: "skill", prompt, marker: "HB_SKILL_TESTMARK" },
    cwd: root,
    binary: process.execPath,
    prefixArgs: [script]
  });
  assert.equal(result.status, "passed");
  const args = JSON.parse(await readFile(argumentsPath, "utf8")) as string[];
  assert.equal(args[args.indexOf("--print") + 1], prompt);
  assert.ok(args.some((argument) => argument.startsWith("--allowedTools=")));
});
