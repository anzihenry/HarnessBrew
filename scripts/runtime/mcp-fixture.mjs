import { appendFile } from "node:fs/promises";
import readline from "node:readline";

const [nonce, logPath] = process.argv.slice(2);
if (nonce === undefined || !/^HB_[A-Z0-9_]+$/u.test(nonce)) {
  console.error("Usage: node mcp-fixture.mjs <HB_NONCE> [log-path]");
  process.exit(2);
}

async function record(event) {
  const destination = logPath ?? process.env.HARNESSBREW_RUNTIME_MCP_LOG;
  if (destination !== undefined && destination !== "") {
    await appendFile(destination, `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`, "utf8");
  }
}

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function fail(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", async (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    fail(null, -32700, "Parse error");
    return;
  }
  if (request.id === undefined) return;
  if (request.method === "initialize") {
    respond(request.id, {
      protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "harnessbrew-runtime-probe", version: "1.0.0" }
    });
    return;
  }
  if (request.method === "ping") {
    respond(request.id, {});
    return;
  }
  if (request.method === "tools/list") {
    respond(request.id, {
      tools: [{
        name: "harnessbrew_runtime_nonce",
        description: "Return the HarnessBrew release verification nonce.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false }
      }]
    });
    return;
  }
  if (request.method === "tools/call" && request.params?.name === "harnessbrew_runtime_nonce") {
    await record({ event: "tool-called", tool: request.params.name, nonce });
    respond(request.id, { content: [{ type: "text", text: nonce }] });
    return;
  }
  fail(request.id, -32601, `Method not found: ${String(request.method)}`);
});

await record({ event: "server-started", nonce });
