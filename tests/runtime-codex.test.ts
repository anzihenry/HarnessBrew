import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

interface CodexModule {
  parseCodexJsonLines(stdout: string): Array<Record<string, unknown>>;
  classifyRuntimeFailure(text: string, state?: { timedOut?: boolean }): { failureClass: string };
  runCodexProbe(options: Record<string, unknown>): Promise<Record<string, unknown>>;
}
const codexModule = await import(pathToFileURL(path.resolve("scripts/runtime/codex.mjs")).href) as CodexModule;

async function fakeCodex(root: string): Promise<string> {
  const script = path.join(root, "fake-codex.mjs");
  await writeFile(script, `
    const prompt = process.argv.at(-1);
    if (prompt.includes("AUTH_FAILURE")) {
      console.error("Not logged in; authentication required");
      process.exit(1);
    }
    console.log(JSON.stringify({ type: "thread.started", thread_id: "test" }));
    if (prompt.includes("MCP_EVENT")) console.log(JSON.stringify({
      type: "item.completed",
      item: { type: "mcp_tool_call", server: "harnessbrew-runtime-mcp", tool: "harnessbrew_runtime_nonce" }
    }));
    console.log(JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: prompt.includes("OMIT_MARKER") ? "no marker" : "HB_SKILL_TESTMARK" }
    }));
    console.log(JSON.stringify({ type: "turn.completed", usage: {} }));
  `, "utf8");
  return script;
}

test("Codex runtime adapter parses JSONL and requires final-message plus structured evidence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-runtime-codex-"));
  const script = await fakeCodex(root);
  const passed = await codexModule.runCodexProbe({
    probe: {
      name: "mcp",
      prompt: "MCP_EVENT",
      marker: "HB_SKILL_TESTMARK",
      requiredEvent: { itemType: "mcp_tool_call", textIncludes: "harnessbrew_runtime_nonce" }
    },
    cwd: root,
    binary: process.execPath,
    prefixArgs: [script]
  });
  assert.equal(passed.status, "passed");
  assert.equal(passed.markerObserved, true);
  assert.equal(passed.requiredEventObserved, true);
  assert.deepEqual((passed.evidence as { toolCalls: unknown[] }).toolCalls, [{
    type: "mcp_tool_call", server: "harnessbrew-runtime-mcp", tool: "harnessbrew_runtime_nonce"
  }]);

  const missing = await codexModule.runCodexProbe({
    probe: { name: "skill", prompt: "OMIT_MARKER", marker: "HB_SKILL_TESTMARK" },
    cwd: root,
    binary: process.execPath,
    prefixArgs: [script]
  });
  assert.equal(missing.failureClass, "behavioral-failure");
});

test("Codex runtime adapter classifies authentication and provider failures without exposing output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-runtime-codex-"));
  const script = await fakeCodex(root);
  const auth = await codexModule.runCodexProbe({
    probe: { name: "skill", prompt: "AUTH_FAILURE", marker: "HB_SKILL_TESTMARK" },
    cwd: root,
    binary: process.execPath,
    prefixArgs: [script]
  });
  assert.equal(auth.failureClass, "environment-failure");
  assert.equal("stdout" in auth, false);
  assert.equal("stderr" in auth, false);
  assert.equal(codexModule.classifyRuntimeFailure("429 rate limit").failureClass, "provider-failure");
  assert.throws(() => codexModule.parseCodexJsonLines("not-json\n"), /invalid JSONL/u);
});
