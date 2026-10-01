import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ConfigValue, TargetAdapter } from "../domain/adapter.js";
import { HarnessError } from "../domain/errors.js";
import { array, record, text } from "../domain/validation.js";

const body = (content: string) => content.endsWith("\n") ? content : `${content}\n`;
function env(value: unknown): string {
  const name = text(value, "environment variable");
  if (!/^[A-Z_][A-Z0-9_]*$/u.test(name)) throw new HarnessError("INVALID_PLAN", "Credentials must refer to environment variable names.");
  return name;
}
function mcp(content: string): ConfigValue {
  let value: unknown;
  try { value = JSON.parse(content); } catch (cause) { throw new HarnessError("INVALID_PLAN", "MCP entry must be JSON.", {}, { cause }); }
  const item = record(value, "MCP definition", ["transport", "command", "args", "envVars", "url", "bearerTokenEnvVar", "headersFromEnv"]);
  if (item.transport === "stdio") {
    record(value, "stdio MCP", ["transport", "command", "args", "envVars"]);
    return { command: text(item.command, "MCP command"), args: array(item.args ?? [], "MCP args", value => typeof value === "string" ? value : text(value, "argument")), env_vars: array(item.envVars ?? [], "environment names", env) };
  }
  if (item.transport !== "http") throw new HarnessError("INVALID_PLAN", "MCP transport must be stdio or http.");
  record(value, "HTTP MCP", ["transport", "url", "bearerTokenEnvVar", "headersFromEnv"]);
  const url = new URL(text(item.url, "MCP URL"));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new HarnessError("INVALID_PLAN", "MCP URL must be HTTP(S) without embedded credentials.");
  const headers = item.headersFromEnv ?? {};
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) throw new HarnessError("INVALID_PLAN", "Invalid environment-backed headers.");
  return { url: url.toString(), ...(item.bearerTokenEnvVar === undefined ? {} : { bearer_token_env_var: env(item.bearerTokenEnvVar) }),
    env_http_headers: Object.fromEntries(Object.entries(headers).map(([name, variable]) => [name, env(variable)])) };
}
export const codexAdapter: TargetAdapter = {
  protocol: "harnessbrew.adapter/1", name: "openai-codex", version: "1",
  supportedKinds: ["skill", "agent", "workflow", "prompt", "instruction", "mcp"],
  requiredCapabilities: ["link-directory", "write-file", "write-block", "set-config"],
  async plan(asset, placement) {
    const name = asset.manifest.coordinate.split("/")[2]!;
    const roots = placement.roots;
    const entry = await asset.readText(asset.manifest.entry);
    switch (asset.manifest.kind) {
      case "skill": {
        if (asset.manifest.entry !== "SKILL.md") throw new HarnessError("INVALID_PLAN", "Codex skills require SKILL.md at the asset root.");
        const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(entry);
        let metadata: unknown;
        try { metadata = match && parseYaml(match[1]!); } catch (cause) { throw new HarnessError("INVALID_PLAN", "Invalid skill frontmatter.", {}, { cause }); }
        if (!metadata || typeof metadata !== "object" || (metadata as { name?: unknown }).name !== name || typeof (metadata as { description?: unknown }).description !== "string" || !(metadata as { description: string }).description.trim()) throw new HarnessError("INVALID_PLAN", "Skill frontmatter must contain matching name and description.");
        return { operations: [{ type: "link-directory", resource: { kind: "path", path: path.join(roots.skills, name), pathType: "directory" }, sourceRelativePath: "." }] };
      }
      case "workflow": case "prompt":
        return { operations: [{ type: "write-file", resource: { kind: "path", path: path.join(roots.skills, name, "SKILL.md"), pathType: "file" },
          mode: 0o644, content: `---\n${stringifyYaml({ name, description: asset.manifest.description }).trimEnd()}\n---\n\n${body(entry)}` }] };
      case "agent":
        return { operations: [{ type: "write-file", resource: { kind: "path", path: path.join(roots.config, "agents", `${name}.toml`), pathType: "file" }, mode: 0o644,
          content: `name = ${JSON.stringify(name)}\ndescription = ${JSON.stringify(asset.manifest.description)}\ndeveloper_instructions = ${JSON.stringify(body(entry))}\n` }] };
      case "instruction":
        return { operations: [{ type: "write-block", resource: { kind: "block", path: path.join(roots.instructions, "AGENTS.md"), marker: asset.manifest.coordinate }, blockFormat: "html-comment", content: body(entry) }] };
      case "mcp":
        return { operations: [{ type: "set-config", resource: { kind: "config", path: path.join(roots.config, "config.toml"), format: "toml", keyPath: ["mcp_servers", name] }, value: mcp(entry) }] };
      default: throw new HarnessError("TARGET_UNSUPPORTED", `Codex does not project ${asset.manifest.kind}.`);
    }
  }
};
