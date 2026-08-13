import { spawnCapture } from "./process.mjs";

export function parseCodexJsonLines(stdout) {
  return stdout.split(/\r?\n/u).filter((line) => line.trim() !== "").map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Codex emitted invalid JSONL at line ${index + 1}.`);
    }
  });
}

export function classifyRuntimeFailure(text, { timedOut = false, outputExceeded = false } = {}) {
  if (outputExceeded) return { failureClass: "environment-failure", diagnostic: "Runtime output exceeded the safety limit." };
  if (timedOut) return { failureClass: "provider-failure", diagnostic: "Runtime request timed out." };
  if (/not logged in|authentication|authenticate|login required|api key|credential/iu.test(text)) {
    return { failureClass: "environment-failure", diagnostic: "Codex authentication is unavailable." };
  }
  if (/rate.?limit|\b429\b|\b5\d\d\b|overloaded|service unavailable|network|connection (?:reset|refused)|dns/iu.test(text)) {
    return { failureClass: "provider-failure", diagnostic: "Codex provider or network request failed." };
  }
  return { failureClass: "product-failure", diagnostic: "Codex could not execute the installed runtime probe." };
}

function agentMessages(events) {
  return events
    .filter((event) => event.type === "item.completed" && event.item?.type === "agent_message")
    .map((event) => event.item.text)
    .filter((text) => typeof text === "string");
}

function eventEvidence(events) {
  const items = events.map((event) => event.item).filter((item) => item !== undefined);
  const toolCalls = items.filter((item) => /tool_call|mcp/iu.test(String(item.type))).map((item) => ({
    type: String(item.type),
    server: typeof item.server === "string" ? item.server : undefined,
    tool: typeof item.tool === "string" ? item.tool : typeof item.name === "string" ? item.name : undefined
  }));
  return {
    eventTypes: [...new Set(events.map((event) => String(event.type)))].sort(),
    itemTypes: [...new Set(items.map((item) => String(item.type)))].sort(),
    toolCalls
  };
}

function matchesRequiredEvent(events, requiredEvent) {
  if (requiredEvent === undefined) return true;
  return events.some((event) => {
    const item = event.item;
    if (item === undefined) return false;
    if (requiredEvent.itemType !== undefined && item.type !== requiredEvent.itemType) return false;
    return requiredEvent.textIncludes === undefined || JSON.stringify(item).includes(requiredEvent.textIncludes);
  });
}

export async function runCodexProbe({
  probe,
  cwd,
  binary = "codex",
  prefixArgs = [],
  environment = process.env,
  timeoutMs
}) {
  const projectTrustOverride = `projects.${JSON.stringify(cwd)}.trust_level="trusted"`;
  const execution = await spawnCapture(binary, [
    ...prefixArgs,
    "exec",
    "--config",
    projectTrustOverride,
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    probe.prompt
  ], { cwd, environment, timeoutMs });
  let events = [];
  let parseError;
  try {
    events = parseCodexJsonLines(execution.stdout);
  } catch (error) {
    parseError = error;
  }
  const evidence = eventEvidence(events);
  const markerObserved = agentMessages(events).some((message) => message.includes(probe.marker));
  const requiredEventObserved = matchesRequiredEvent(events, probe.requiredEvent);
  if (execution.exitCode === 0 && parseError === undefined && markerObserved && requiredEventObserved) {
    return {
      runtime: "codex",
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
      runtime: "codex",
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
    ? classifyRuntimeFailure(`${execution.stderr}\n${execution.stdout}`, execution)
    : { failureClass: "product-failure", diagnostic: parseError.message };
  return {
    runtime: "codex",
    probe: probe.name,
    status: "failed",
    ...failure,
    markerObserved,
    requiredEventObserved,
    durationMs: execution.durationMs,
    evidence
  };
}
