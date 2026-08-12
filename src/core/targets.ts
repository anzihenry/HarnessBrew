import { createHash } from "node:crypto";
import { lstat, readFile, readlink, rm, stat } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { HarnessBrewError } from "./errors.js";
import type { FormulaKind } from "./formulas.js";
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
import { builtinTargets, targetCapability, type BuiltinTarget } from "./target-capabilities.js";
import { executeTargetOperations, removeTargetOperation, verifyTargetOperation } from "./targets/transaction.js";
import { planTargetInstall } from "./targets/planner.js";
import { renderAgent, renderMcpConfig, renderSkillProjection } from "./targets/renderers.js";
import type { TargetContext, TargetScope } from "./targets/types.js";
import { captureTransactionPath, markTransactionPath } from "./journal.js";
import { assertTapTrusted } from "./taps.js";

export { builtinTargets } from "./target-capabilities.js";
export type { BuiltinTarget } from "./target-capabilities.js";
export type { TargetScope } from "./targets/types.js";

export interface LinkOptions {
  root?: string;
  scope?: TargetScope;
  projectRoot?: string;
}

export interface UnlinkOptions extends LinkOptions {
  force?: boolean;
}

function targetContext(options: LinkOptions): TargetContext {
  const scope = options.scope ?? "user";
  return {
    scope,
    ...(options.root === undefined ? {} : { root: path.resolve(options.root) }),
    ...(scope === "project" ? { projectRoot: path.resolve(options.projectRoot ?? process.cwd()) } : {})
  };
}

export function targetDestination(
  receipt: InstallReceipt,
  target: BuiltinTarget,
  options: LinkOptions = {}
): string {
  if (targetCapability(target, receipt.kind as FormulaKind) === "unsupported") {
    throw new HarnessBrewError(`Formula kind ${receipt.kind} cannot be linked to target ${target}.`);
  }
  const plan = planTargetInstall(receipt, target, targetContext(options));
  const operation = plan.operations[0];
  if (operation === undefined) throw new HarnessBrewError(`No target operation planned for ${receipt.coordinate}.`);
  return receipt.kind === "workflow" || receipt.kind === "prompt"
    ? path.join(operation.destination, "SKILL.md")
    : operation.destination;
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
  await assertTapTrusted(home, receipt.tap);
  if (!receipt.supportedTargets.includes(target)) {
    throw new HarnessBrewError(`Formula ${receipt.coordinate} does not support target ${target}.`);
  }
  if (targetCapability(target, receipt.kind as FormulaKind) === "unsupported") {
    throw new HarnessBrewError(
      `Formula kind ${receipt.kind} cannot be linked to target ${target}; install it to the Cellar without --target.`
    );
  }
  if (receipt.kind === "skill") await validateSkillDirectory(receipt);
  const context = targetContext(options);
  const destination = targetDestination(receipt, target, options);
  const existingOperation = receipt.operations.find((operation) => operation.target === target
    && operation.destination === destination);
  if (existingOperation !== undefined) {
    try {
      await verifyTargetOperation(existingOperation);
      return receipt;
    } catch {
      throw new HarnessBrewError(`Installed target was modified for ${receipt.coordinate}: ${existingOperation.destination}`);
    }
  }

  const source = receipt.kind === "skill" ? receipt.cellarPath : path.join(receipt.cellarPath, receipt.entry);
  const type = receipt.kind === "skill"
    ? "symlink-directory"
    : receipt.kind === "agent" || receipt.kind === "workflow" || receipt.kind === "prompt"
      ? "render-file"
      : receipt.kind === "instruction" && target === "openai-codex"
        ? "managed-block"
        : receipt.kind === "mcp"
          ? "merge-config"
        : "symlink-file";
  if (type !== "managed-block" && type !== "merge-config") await assertDestinationAvailable(home, receipt, destination);
  const mcpConfig = receipt.kind === "mcp" ? await renderMcpConfig(receipt, target) : undefined;
  const [operation] = await executeTargetOperations([{
    id: `${receipt.coordinate}:${target}:${destination}`,
    type,
    target,
    ...(context.scope === undefined ? {} : { scope: context.scope }),
    ...(context.root === undefined ? {} : { root: context.root }),
    ...(context.projectRoot === undefined ? {} : { projectRoot: context.projectRoot }),
    ...(type === "render-file"
      ? { content: receipt.kind === "agent"
        ? await renderAgent(receipt, target)
        : await renderSkillProjection(receipt) }
      : type === "managed-block"
        ? { content: await readFile(source, "utf8"), marker: receipt.coordinate }
        : type === "merge-config" && mcpConfig !== undefined
          ? mcpConfig
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
  options: UnlinkOptions | boolean = {}
): Promise<InstallReceipt> {
  const resolvedOptions: UnlinkOptions = typeof options === "boolean" ? { force: options } : options;
  const force = resolvedOptions.force ?? false;
  const receipt = await readReceipt(home, nameOrCoordinate.split("/").length === 3
    ? nameOrCoordinate
    : (await listInstalled(home)).find((item) => item.coordinate.endsWith(`/${nameOrCoordinate}`))?.coordinate ?? nameOrCoordinate);
  if (receipt === undefined) throw new HarnessBrewError(`Formula is not installed: ${nameOrCoordinate}`);
  const placementSpecified = resolvedOptions.root !== undefined
    || resolvedOptions.scope !== undefined
    || resolvedOptions.projectRoot !== undefined;
  const targetOperations = receipt.operations.filter((operation) => operation.target === target);
  if (!placementSpecified && targetOperations.length > 1) {
    throw new HarnessBrewError(
      `Formula has multiple ${target} installations; specify --scope and, for project scope, --project.`
    );
  }
  const destination = !placementSpecified && targetOperations[0] !== undefined
    ? targetOperations[0].destination
    : targetDestination(receipt, target, resolvedOptions);
  const links = receipt.links.filter((link) => link.target === target && link.path === destination);
  const operations = receipt.operations.filter((operation) => operation.target === target
    && operation.destination === destination);
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
    for (const link of links) {
      await captureTransactionPath(link.path);
      await rm(link.path, { force: true });
      await markTransactionPath(link.path);
    }
  }
  receipt.links = receipt.links.filter((link) => !links.includes(link));
  receipt.operations = receipt.operations.filter((operation) => !operations.includes(operation));
  if (!receipt.operations.some((operation) => operation.target === target)
    && !receipt.links.some((link) => link.target === target)) {
    receipt.targets = receipt.targets.filter((installedTarget) => installedTarget !== target);
  }
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
      await unlinkFormula(home, receipt.coordinate, target, { ...options, force: true });
    }
    for (const receipt of receipts.reverse()) {
      if (!before.has(receipt.coordinate)) await uninstallFormula(home, receipt.coordinate, { force: true });
    }
    throw error;
  }
}
