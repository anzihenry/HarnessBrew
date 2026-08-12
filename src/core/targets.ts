import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { lstat, readFile, readlink, rm, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { HarnessBrewError } from "./errors.js";
import {
  installFormula,
  listInstalled,
  readReceipt,
  uninstallFormula,
  writeReceipt,
  type InstallReceipt,
  type InstalledLink
} from "./installations.js";
import { parseCoordinate } from "./paths.js";
import { builtinTargets, type BuiltinTarget } from "./target-capabilities.js";
import { executeTargetOperations, removeTargetOperation, verifyTargetOperation } from "./targets/transaction.js";
import { planTargetInstall } from "./targets/planner.js";
import { renderAgent, renderSkillProjection } from "./targets/renderers.js";

export { builtinTargets } from "./target-capabilities.js";
export type { BuiltinTarget } from "./target-capabilities.js";

export interface LinkOptions {
  root?: string;
}

function defaultRoot(target: BuiltinTarget): string {
  return path.join(homedir(), target === "openai-codex" ? ".codex" : ".claude");
}

function extensionFor(entry: string): string {
  return path.extname(entry) || ".md";
}

export function targetDestination(receipt: InstallReceipt, target: BuiltinTarget, root?: string): string {
  if (receipt.kind === "skill" || receipt.kind === "agent" || receipt.kind === "instruction"
    || receipt.kind === "workflow" || receipt.kind === "prompt") {
    const plan = planTargetInstall(receipt, target, root === undefined ? {} : { root });
    const operation = plan.operations[0];
    if (operation === undefined) throw new HarnessBrewError(`No target operation planned for ${receipt.coordinate}.`);
    return receipt.kind === "workflow" || receipt.kind === "prompt"
      ? path.join(operation.destination, "SKILL.md")
      : operation.destination;
  }
  const targetRoot = path.resolve(root ?? defaultRoot(target));
  const [, , name] = parseCoordinate(receipt.coordinate);
  const extension = extensionFor(receipt.entry);

  if (target === "claude-code" && receipt.kind === "workflow") {
    return path.join(targetRoot, "commands", `${name}${extension}`);
  }
  const directory = (() => {
    switch (receipt.kind) {
      case "agent": return "agents";
      case "workflow": return "workflows";
      case "instruction": return "rules";
      case "prompt": return "prompts";
      case "mcp": return "mcp";
      case "adapter": return "adapters";
      default: throw new HarnessBrewError(`Unsupported formula kind for target linking: ${receipt.kind}`);
    }
  })();
  return path.join(targetRoot, directory, `${name}${extension}`);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function validateSkillDirectory(receipt: InstallReceipt): Promise<void> {
  if (receipt.entry !== "SKILL.md") {
    throw new HarnessBrewError(`Skill entry must be SKILL.md: ${receipt.coordinate}`);
  }
  const content = await readFile(path.join(receipt.cellarPath, "SKILL.md"), "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
  if (match?.[1] === undefined) {
    throw new HarnessBrewError(`Skill SKILL.md must contain YAML frontmatter: ${receipt.coordinate}`);
  }
  let frontmatter: unknown;
  try {
    frontmatter = parse(match[1]);
  } catch {
    throw new HarnessBrewError(`Skill SKILL.md contains invalid YAML frontmatter: ${receipt.coordinate}`);
  }
  if (typeof frontmatter !== "object" || frontmatter === null) {
    throw new HarnessBrewError(`Skill SKILL.md frontmatter must be an object: ${receipt.coordinate}`);
  }
  const metadata = frontmatter as Record<string, unknown>;
  if (metadata.name !== parseCoordinate(receipt.coordinate)[2]
    || typeof metadata.description !== "string"
    || metadata.description.trim() === "") {
    throw new HarnessBrewError(`Skill SKILL.md must declare matching name and description: ${receipt.coordinate}`);
  }
}

async function assertDestinationAvailable(
  home: string,
  receipt: InstallReceipt,
  destination: string
): Promise<void> {
  const installed = await listInstalled(home);
  const owner = installed.find((candidate) => candidate.operations.some((operation) => operation.destination === destination)
    || candidate.links.some((link) => link.path === destination));
  if (owner !== undefined && owner.coordinate !== receipt.coordinate) {
    throw new HarnessBrewError(`Target path is owned by ${owner.coordinate}: ${destination}`);
  }
  if (await exists(destination)) {
    throw new HarnessBrewError(`Target path already exists and is not managed by HarnessBrew: ${destination}`);
  }
}

export async function linkFormula(
  home: string,
  nameOrCoordinate: string,
  target: BuiltinTarget,
  options: LinkOptions = {}
): Promise<InstallReceipt> {
  const installed = await listInstalled(home);
  const matches = nameOrCoordinate.split("/").length === 3
    ? installed.filter((receipt) => receipt.coordinate === nameOrCoordinate)
    : installed.filter((receipt) => receipt.coordinate.endsWith(`/${nameOrCoordinate}`));
  if (matches.length !== 1) {
    throw new HarnessBrewError(matches.length === 0
      ? `Formula is not installed: ${nameOrCoordinate}`
      : `Installed formula name is ambiguous: ${nameOrCoordinate}`);
  }
  const receipt = matches[0] as InstallReceipt;
  if (!receipt.supportedTargets.includes(target)) {
    throw new HarnessBrewError(`Formula ${receipt.coordinate} does not support target ${target}.`);
  }
  if (receipt.kind === "skill") await validateSkillDirectory(receipt);
  const existingOperation = receipt.operations.find((operation) => operation.target === target);
  if (existingOperation !== undefined) {
    try {
      await verifyTargetOperation(existingOperation);
      return receipt;
    } catch {
      throw new HarnessBrewError(`Installed target was modified for ${receipt.coordinate}: ${existingOperation.destination}`);
    }
  }

  const source = receipt.kind === "skill" ? receipt.cellarPath : path.join(receipt.cellarPath, receipt.entry);
  const destination = targetDestination(receipt, target, options.root);
  const type = receipt.kind === "skill"
    ? "symlink-directory"
    : receipt.kind === "agent" || receipt.kind === "workflow" || receipt.kind === "prompt"
      ? "render-file"
      : receipt.kind === "instruction" && target === "openai-codex"
        ? "managed-block"
        : "symlink-file";
  if (type !== "managed-block") await assertDestinationAvailable(home, receipt, destination);
  const [operation] = await executeTargetOperations([{
    id: `${receipt.coordinate}:${target}:${destination}`,
    type,
    target,
    ...(type === "render-file"
      ? { content: receipt.kind === "agent"
        ? await renderAgent(receipt, target)
        : await renderSkillProjection(receipt) }
      : type === "managed-block"
        ? { content: await readFile(source, "utf8"), marker: receipt.coordinate }
        : { source }),
    destination
  }]);
  if (operation === undefined) throw new HarnessBrewError(`Target operation was not created: ${destination}`);
  if (type === "symlink-file" || type === "symlink-directory") {
    const link: InstalledLink = {
      path: destination,
      source,
      target,
      sha256: operation.installedDigest ?? await sha256(path.join(receipt.cellarPath, receipt.entry))
    };
    receipt.links.push(link);
  }
  receipt.operations.push(operation);
  if (!receipt.targets.includes(target)) receipt.targets.push(target);
  try {
    await writeReceipt(home, receipt);
  } catch (error) {
    await removeTargetOperation(operation, true);
    throw error;
  }
  return receipt;
}

export async function unlinkFormula(
  home: string,
  nameOrCoordinate: string,
  target: BuiltinTarget,
  force = false
): Promise<InstallReceipt> {
  const receipt = await readReceipt(home, nameOrCoordinate.split("/").length === 3
    ? nameOrCoordinate
    : (await listInstalled(home)).find((item) => item.coordinate.endsWith(`/${nameOrCoordinate}`))?.coordinate ?? nameOrCoordinate);
  if (receipt === undefined) throw new HarnessBrewError(`Formula is not installed: ${nameOrCoordinate}`);
  const links = receipt.links.filter((link) => link.target === target);
  const operations = receipt.operations.filter((operation) => operation.target === target);
  if (links.length === 0 && operations.length === 0) {
    throw new HarnessBrewError(`Formula is not linked to ${target}: ${receipt.coordinate}`);
  }
  for (const link of links) {
    if (!force) {
      try {
        if (!(await lstat(link.path)).isSymbolicLink() || path.resolve(path.dirname(link.path), await readlink(link.path)) !== link.source) {
          throw new Error("changed");
        }
      } catch {
        throw new HarnessBrewError(`Installed target was modified for ${receipt.coordinate}: ${link.path}`);
      }
    }
  }
  if (operations.length > 0) {
    for (const operation of operations) await removeTargetOperation(operation, force);
  } else {
    for (const link of links) await rm(link.path, { force: true });
  }
  receipt.links = receipt.links.filter((link) => link.target !== target);
  receipt.operations = receipt.operations.filter((operation) => operation.target !== target);
  receipt.targets = receipt.targets.filter((installedTarget) => installedTarget !== target);
  await writeReceipt(home, receipt);
  return receipt;
}

export async function installForTarget(
  home: string,
  nameOrCoordinate: string,
  target: BuiltinTarget,
  options: LinkOptions = {}
): Promise<InstallReceipt[]> {
  const before = new Set((await listInstalled(home)).map((receipt) => receipt.coordinate));
  const receipts = await installFormula(home, nameOrCoordinate);
  const linked: InstallReceipt[] = [];
  try {
    for (const receipt of receipts) {
      linked.push(await linkFormula(home, receipt.coordinate, target, options));
    }
    return linked;
  } catch (error) {
    for (const receipt of linked.reverse()) {
      await unlinkFormula(home, receipt.coordinate, target, true);
    }
    for (const receipt of receipts.reverse()) {
      if (!before.has(receipt.coordinate)) await uninstallFormula(home, receipt.coordinate, { force: true });
    }
    throw error;
  }
}
