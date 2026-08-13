import { spawnCapture } from "./process.mjs";

export function parseClaudeStreamJson(stdout) {
  return stdout.split(/\r?\n/u).filter((line) => line.trim() !== "").map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Claude Code emitted invalid stream JSON at line ${index + 1}.`);
    }
  });
}

export function classifyClaudeFailure(text, { timedOut = false, outputExceeded = false } = {}) {
  if (outputExceeded) return { failureClass: "environment-failure", diagnostic: "Runtime output exceeded the safety limit." };
  if (timedOut) return { failureClass: "provider-failure", diagnostic: "Runtime request timed out." };
  if (/not logged in|authentication|authenticate|login required|api key|credential|oauth/iu.test(text)) {
    return { failureClass: "environment-failure", diagnostic: "Claude Code authentication is unavailable." };
  }
  if (/rate.?limit|\b429\b|\b5\d\d\b|overloaded|service unavailable|network|connection (?:reset|refused)|dns/iu.test(text)) {
    return { failureClass: "provider-failure", diagnostic: "Claude provider or network request failed." };
  }
  return { failureClass: "product-failure", diagnostic: "Claude Code could not execute the installed runtime probe." };
}

function contentBlocks(events) {
  return events.flatMap((event) => Array.isArray(event.message?.content) ? event.message.content : []);
}

function finalResults(events) {
  return events.filter((event) => event.type === "result" && typeof event.result === "string").map((event) => event.result);
}

function eventEvidence(events) {
  const blocks = contentBlocks(events);
  return {
    eventTypes: [...new Set(events.map((event) => String(event.type)))].sort(),
    contentTypes: [...new Set(blocks.map((block) => String(block.type)))].sort(),
    toolCalls: blocks.filter((block) => block.type === "tool_use").map((block) => ({ name: String(block.name) }))
  };
}

function matchesRequiredEvent(events, requiredEvent) {
  if (requiredEvent === undefined) return true;
  return contentBlocks(events).some((block) => {
    if (block.type !== "tool_use") return false;
    if (requiredEvent.toolNameIncludes !== undefined && !String(block.name).includes(requiredEvent.toolNameIncludes)) return false;
    return requiredEvent.textIncludes === undefined || JSON.stringify(block).includes(requiredEvent.textIncludes);
  });
}

export async function runClaudeProbe({
  probe,
  cwd,
  binary = "claude",
  prefixArgs = [],
  environment = process.env,
  timeoutMs
}) {
  const execution = await spawnCapture(binary, [
    ...prefixArgs,
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    "--no-session-persistence",
    "--setting-sources",
    "project",
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    "Skill,Task,mcp__harnessbrew-runtime-mcp__harnessbrew_runtime_nonce",
    probe.prompt
  ], { cwd, environment, timeoutMs });
  let events = [];
  let parseError;
  try {
    events = parseClaudeStreamJson(execution.stdout);
  } catch (error) {
    parseError = error;
  }
  const evidence = eventEvidence(events);
  const markerObserved = finalResults(events).some((result) => result.includes(probe.marker));
  const requiredEventObserved = matchesRequiredEvent(events, probe.requiredEvent);
  if (execution.exitCode === 0 && parseError === undefined && markerObserved && requiredEventObserved) {
    return {
      runtime: "claude-code",
      probe: probe.name,
      status: "passed",
      failureClass: null,
      markerObserved,
      requiredEventObserved,
      durationMs: execution.durationMs,
      evidence
    };
  }
  if (execution.exitCode === 0 && parseError === undefined) {
    return {
      runtime: "claude-code",
      probe: probe.name,
      status: "failed",
      failureClass: "behavioral-failure",
      markerObserved,
      requiredEventObserved,
      durationMs: execution.durationMs,
      diagnostic: markerObserved ? "Required structured runtime event was not observed." : "Expected marker was absent from the final Agent response.",
      evidence
    };
  }
  const failure = parseError === undefined
    ? classifyClaudeFailure(`${execution.stderr}\n${execution.stdout}`, execution)
    : { failureClass: "product-failure", diagnostic: parseError.message };
  return {
    runtime: "claude-code",
    probe: probe.name,
    status: "failed",
    ...failure,
    markerObserved,
    requiredEventObserved,
    durationMs: execution.durationMs,
    evidence
  };
}
