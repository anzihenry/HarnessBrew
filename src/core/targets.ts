import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { lstat, mkdir, readFile, readlink, rm, stat, symlink } from "node:fs/promises";
import path from "node:path";
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
  const targetRoot = path.resolve(root ?? defaultRoot(target));
  const [, , name] = parseCoordinate(receipt.coordinate);
  const extension = extensionFor(receipt.entry);

  if (receipt.kind === "skill") return path.join(targetRoot, "skills", name, path.basename(receipt.entry));
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

async function assertDestinationAvailable(
  home: string,
  receipt: InstallReceipt,
  destination: string
): Promise<void> {
  const installed = await listInstalled(home);
  const owner = installed.find((candidate) => candidate.links.some((link) => link.path === destination));
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
  const existing = receipt.links.find((link) => link.target === target);
  if (existing !== undefined) {
    try {
      if ((await lstat(existing.path)).isSymbolicLink() && path.resolve(path.dirname(existing.path), await readlink(existing.path)) === existing.source) {
        return receipt;
      }
    } catch {
      // Report the broken managed destination through the standard conflict check.
    }
  }

  const source = path.join(receipt.cellarPath, receipt.entry);
  const destination = targetDestination(receipt, target, options.root);
  await assertDestinationAvailable(home, receipt, destination);
  await mkdir(path.dirname(destination), { recursive: true });
  await symlink(source, destination, "file");
  const link: InstalledLink = { path: destination, source, target, sha256: await sha256(source) };
  receipt.links.push(link);
  if (!receipt.targets.includes(target)) receipt.targets.push(target);
  try {
    await writeReceipt(home, receipt);
  } catch (error) {
    await rm(destination, { force: true });
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
  if (links.length === 0) throw new HarnessBrewError(`Formula is not linked to ${target}: ${receipt.coordinate}`);
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
    await rm(link.path, { force: true });
  }
  receipt.links = receipt.links.filter((link) => link.target !== target);
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
