import { readFile } from "node:fs/promises";
import path from "node:path";
import { stringify } from "yaml";
import type { InstallReceipt } from "../installations.js";
import { parseCoordinate } from "../paths.js";
import type { BuiltinTarget } from "../target-capabilities.js";

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
