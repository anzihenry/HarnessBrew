import { lstat } from "node:fs/promises";
import path from "node:path";
import { HarnessBrewError } from "./errors.js";
import {
  listInstalled,
  verifyCellarIntegrity,
  writeReceipt,
  type InstallReceipt,
  type InstalledOperation
} from "./installations.js";
import {
  linkFormula,
  targetDestination,
  type BuiltinTarget,
  type LinkOptions
} from "./targets.js";
import { removeTargetOperation, verifyTargetOperation } from "./targets/transaction.js";

export type DoctorFindingKind = "cellar-modified" | "target-missing" | "target-modified";

export interface DoctorFinding {
  coordinate: string;
  kind: DoctorFindingKind;
  message: string;
  target?: string;
  destination?: string;
  operationId?: string;
}

export interface DoctorReport {
  checked: number;
  healthy: boolean;
  findings: DoctorFinding[];
}

export interface RelinkOptions extends LinkOptions {
  target?: BuiltinTarget;
}

function matchingReceipts(receipts: InstallReceipt[], nameOrCoordinate?: string): InstallReceipt[] {
  if (nameOrCoordinate === undefined) return receipts;
  const matches = nameOrCoordinate.split("/").length === 3
    ? receipts.filter((receipt) => receipt.coordinate === nameOrCoordinate)
    : receipts.filter((receipt) => receipt.coordinate.endsWith(`/${nameOrCoordinate}`));
  if (matches.length === 0) throw new HarnessBrewError(`Formula is not installed: ${nameOrCoordinate}`);
  if (matches.length > 1) throw new HarnessBrewError(`Installed formula name is ambiguous: ${nameOrCoordinate}`);
  return matches;
}

async function destinationExists(destination: string): Promise<boolean> {
  try {
    await lstat(destination);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function doctor(home: string, nameOrCoordinate?: string): Promise<DoctorReport> {
  const receipts = matchingReceipts(await listInstalled(home), nameOrCoordinate);
  const findings: DoctorFinding[] = [];
  for (const receipt of receipts) {
    try {
      await verifyCellarIntegrity(receipt);
    } catch (error) {
      findings.push({
        coordinate: receipt.coordinate,
        kind: "cellar-modified",
        message: (error as Error).message
      });
    }
    for (const operation of receipt.operations) {
      try {
        await verifyTargetOperation(operation);
      } catch (error) {
        const exists = await destinationExists(operation.destination);
        findings.push({
          coordinate: receipt.coordinate,
          kind: exists ? "target-modified" : "target-missing",
          target: operation.target,
          destination: operation.destination,
          operationId: operation.id,
          message: (error as Error).message
        });
      }
    }
  }
  return { checked: receipts.length, healthy: findings.length === 0, findings };
}

function placementSpecified(options: RelinkOptions): boolean {
  return options.scope !== undefined || options.root !== undefined || options.projectRoot !== undefined;
}

function legacyLinkOptions(receipt: InstallReceipt, operation: InstalledOperation): LinkOptions {
  const target = operation.target as BuiltinTarget;
  if (receipt.kind === "workflow" || receipt.kind === "prompt") {
    return { root: path.dirname(path.dirname(path.dirname(operation.destination))) };
  }
  if (receipt.kind === "skill" || receipt.kind === "agent") {
    return { root: path.dirname(path.dirname(operation.destination)) };
  }
  if (receipt.kind === "instruction" && target === "claude-code") {
    return { root: path.dirname(path.dirname(operation.destination)) };
  }
  if (receipt.kind === "mcp" && target === "claude-code" && path.basename(operation.destination) === ".claude.json") {
    return {};
  }
  return { root: path.dirname(operation.destination) };
}

function operationLinkOptions(
  receipt: InstallReceipt,
  operation: InstalledOperation,
  requested: RelinkOptions
): LinkOptions {
  if (operation.scope !== undefined) {
    return {
      scope: operation.scope,
      ...(operation.root === undefined ? {} : { root: operation.root }),
      ...(operation.projectRoot === undefined ? {} : { projectRoot: operation.projectRoot })
    };
  }
  if (requested.target === operation.target && placementSpecified(requested)) {
    return {
      ...(requested.scope === undefined ? {} : { scope: requested.scope }),
      ...(requested.root === undefined ? {} : { root: requested.root }),
      ...(requested.projectRoot === undefined ? {} : { projectRoot: requested.projectRoot })
    };
  }
  return legacyLinkOptions(receipt, operation);
}

function selectedOperations(receipt: InstallReceipt, options: RelinkOptions): InstalledOperation[] {
  if (options.target === undefined) return [...receipt.operations];
  const candidates = receipt.operations.filter((operation) => operation.target === options.target);
  if (candidates.length === 0) {
    throw new HarnessBrewError(`Formula is not linked to ${options.target}: ${receipt.coordinate}`);
  }
  if (!placementSpecified(options)) {
    if (candidates.length > 1) {
      throw new HarnessBrewError(`Formula has multiple ${options.target} installations; specify --scope and --project.`);
    }
    return candidates;
  }
  const destination = targetDestination(receipt, options.target, options);
  const selected = candidates.filter((operation) => operation.destination === destination);
  if (selected.length === 0) {
    throw new HarnessBrewError(`Formula is not linked at the selected ${options.target} scope: ${receipt.coordinate}`);
  }
  return selected;
}

export async function relinkFormula(
  home: string,
  nameOrCoordinate: string,
  options: RelinkOptions = {}
): Promise<InstallReceipt> {
  const [receipt] = matchingReceipts(await listInstalled(home), nameOrCoordinate);
  if (receipt === undefined) throw new HarnessBrewError(`Formula is not installed: ${nameOrCoordinate}`);
  await verifyCellarIntegrity(receipt);
  const selected = selectedOperations(receipt, options);
  if (selected.length === 0) throw new HarnessBrewError(`Formula has no target installations: ${receipt.coordinate}`);
  let current = receipt;
  for (const operation of selected) {
    const linkOptions = operationLinkOptions(receipt, operation, options);
    await removeTargetOperation(operation, true);
    current.operations = current.operations.filter((candidate) => candidate.id !== operation.id);
    current.links = current.links.filter((link) => link.path !== operation.destination);
    if (!current.operations.some((candidate) => candidate.target === operation.target)
      && !current.links.some((link) => link.target === operation.target)) {
      current.targets = current.targets.filter((target) => target !== operation.target);
    }
    await writeReceipt(home, current);
    current = await linkFormula(home, current.coordinate, operation.target as BuiltinTarget, linkOptions);
  }
  return current;
}
