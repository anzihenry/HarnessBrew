import { readFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import { HarnessBrewError } from "../errors.js";
import type { InstallReceipt } from "../installations.js";
import { parseCoordinate } from "../paths.js";
import type { BuiltinTarget } from "../target-capabilities.js";

export interface RenderedMcpConfig {
  content: string;
  configFormat: "json" | "toml-block";
  ownedKeys: string[];
  marker?: string;
}

interface McpStdioDefinition {
  transport: "stdio";
  command: string;
  args: string[];
  envVars: string[];
}

interface McpHttpDefinition {
  transport: "http";
  url: string;
  bearerTokenEnvVar?: string;
  headersFromEnv: Record<string, string>;
}

type McpDefinition = McpStdioDefinition | McpHttpDefinition;

function normalizedBody(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

export async function renderAgent(receipt: InstallReceipt, target: BuiltinTarget): Promise<string> {
  const [, , name] = parseCoordinate(receipt.coordinate);
  const body = normalizedBody(await readFile(path.join(receipt.cellarPath, receipt.entry), "utf8"));
  if (target === "openai-codex") {
    return [
      `name = ${JSON.stringify(name)}`,
      `description = ${JSON.stringify(receipt.description)}`,
      `developer_instructions = ${JSON.stringify(body)}`,
      ""
    ].join("\n");
  }
  const frontmatter = stringify({ name, description: receipt.description }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${body}`;
}

export async function renderSkillProjection(receipt: InstallReceipt): Promise<string> {
  const [, , name] = parseCoordinate(receipt.coordinate);
  const body = normalizedBody(await readFile(path.join(receipt.cellarPath, receipt.entry), "utf8"));
  const frontmatter = stringify({
    name,
    description: receipt.description,
    metadata: {
      harnessbrew: {
        kind: receipt.kind,
        coordinate: receipt.coordinate
      }
    }
  }).trimEnd();
  return `---\n${frontmatter}\n---\n\n${body}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function envName(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^[A-Z_][A-Z0-9_]*$/u.test(value)) {
    throw new HarnessBrewError(`MCP ${field} must contain environment variable names only.`);
  }
  return value;
}

function parseMcpDefinition(content: string): McpDefinition {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new HarnessBrewError("MCP formula entry must be valid JSON.");
  }
  if (!isRecord(value)) throw new HarnessBrewError("MCP formula entry must be a JSON object.");
  const transport = value.transport ?? "stdio";
  if (transport === "stdio") {
    const allowed = new Set(["transport", "command", "args", "envVars"]);
    if (Object.keys(value).some((key) => !allowed.has(key)) || typeof value.command !== "string" || value.command.trim() === "") {
      throw new HarnessBrewError("Invalid stdio MCP definition; use command, args, and envVars.");
    }
    if (value.args !== undefined && (!Array.isArray(value.args) || !value.args.every((item) => typeof item === "string"))) {
      throw new HarnessBrewError("MCP args must be a string array.");
    }
    if (value.envVars !== undefined && !Array.isArray(value.envVars)) throw new HarnessBrewError("MCP envVars must be an array.");
    return {
      transport: "stdio",
      command: value.command,
      args: (value.args ?? []) as string[],
      envVars: (value.envVars ?? []).map((item, index) => envName(item, `envVars[${index}]`))
    };
  }
  if (transport === "http") {
    const allowed = new Set(["transport", "url", "bearerTokenEnvVar", "headersFromEnv"]);
    if (Object.keys(value).some((key) => !allowed.has(key)) || typeof value.url !== "string" || value.url.trim() === "") {
      throw new HarnessBrewError("Invalid HTTP MCP definition; use url and environment-backed credentials.");
    }
    const headers = value.headersFromEnv ?? {};
    if (!isRecord(headers)) throw new HarnessBrewError("MCP headersFromEnv must be an object.");
    return {
      transport: "http",
      url: value.url,
      ...(value.bearerTokenEnvVar === undefined
        ? {}
        : { bearerTokenEnvVar: envName(value.bearerTokenEnvVar, "bearerTokenEnvVar") }),
      headersFromEnv: Object.fromEntries(Object.entries(headers).map(([header, variable]) => [header, envName(variable, `headersFromEnv.${header}`)]))
    };
  }
  throw new HarnessBrewError(`Unsupported MCP transport: ${String(transport)}`);
}

function tomlStringMap(value: Record<string, string>): string {
  return `{ ${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)} = ${JSON.stringify(item)}`).join(", ")} }`;
}

function renderCodexMcp(name: string, definition: McpDefinition): string {
  const lines = [`[mcp_servers.${name}]`];
  if (definition.transport === "stdio") {
    lines.push(`command = ${JSON.stringify(definition.command)}`);
    if (definition.args.length > 0) lines.push(`args = ${JSON.stringify(definition.args)}`);
    if (definition.envVars.length > 0) lines.push(`env_vars = ${JSON.stringify(definition.envVars)}`);
  } else {
    lines.push(`url = ${JSON.stringify(definition.url)}`);
    if (definition.bearerTokenEnvVar !== undefined) {
      lines.push(`bearer_token_env_var = ${JSON.stringify(definition.bearerTokenEnvVar)}`);
    }
    if (Object.keys(definition.headersFromEnv).length > 0) {
      lines.push(`env_http_headers = ${tomlStringMap(definition.headersFromEnv)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function renderClaudeMcp(definition: McpDefinition): Record<string, unknown> {
  if (definition.transport === "stdio") {
    return {
      type: "stdio",
      command: definition.command,
      ...(definition.args.length === 0 ? {} : { args: definition.args }),
      ...(definition.envVars.length === 0
        ? {}
        : { env: Object.fromEntries(definition.envVars.map((name) => [name, `\${${name}}`])) })
    };
  }
  const headers = {
    ...(definition.bearerTokenEnvVar === undefined
      ? {}
      : { Authorization: `Bearer \${${definition.bearerTokenEnvVar}}` }),
    ...Object.fromEntries(Object.entries(definition.headersFromEnv).map(([header, name]) => [header, `\${${name}}`]))
  };
  return {
    type: "http",
    url: definition.url,
    ...(Object.keys(headers).length === 0 ? {} : { headers })
  };
}

export async function renderMcpConfig(receipt: InstallReceipt, target: BuiltinTarget): Promise<RenderedMcpConfig> {
  const [, , name] = parseCoordinate(receipt.coordinate);
  const definition = parseMcpDefinition(await readFile(path.join(receipt.cellarPath, receipt.entry), "utf8"));
  if (target === "openai-codex") {
    return {
      content: renderCodexMcp(name, definition),
      configFormat: "toml-block",
      ownedKeys: ["mcp_servers", name],
      marker: receipt.coordinate
    };
  }
  return {
    content: JSON.stringify(renderClaudeMcp(definition)),
    configFormat: "json",
    ownedKeys: ["mcpServers", name]
  };
}
