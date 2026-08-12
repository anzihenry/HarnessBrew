import { rm } from "node:fs/promises";
import path from "node:path";
import { HarnessBrewError } from "./errors.js";
import { loadCatalog, type CatalogFormula } from "./formulas.js";
import {
  installCatalogFormula,
  listInstalled,
  uninstallFormula,
  verifyReceiptIntegrity,
  writeReceipt,
  type InstallReceipt,
  type InstalledLink
} from "./installations.js";
import { resolveReceiptPath } from "./paths.js";
import { linkFormula, type LinkOptions, type TargetName } from "./targets.js";
import { removeTargetOperation } from "./targets/transaction.js";
import { captureTransactionPath, markTransactionPath } from "./journal.js";
import { assertTapTrusted } from "./taps.js";

export interface OutdatedFormula {
  coordinate: string;
  installedCommit: string;
  availableCommit?: string;
  available: boolean;
}

export interface UpgradeResult {
  coordinate: string;
  before: string;
  after: string;
}

export async function findOutdated(home: string): Promise<OutdatedFormula[]> {
  const catalog = new Map((await loadCatalog(home)).map((formula) => [formula.coordinate, formula]));
  const outdated: OutdatedFormula[] = [];
  for (const receipt of await listInstalled(home)) {
    const formula = catalog.get(receipt.coordinate);
    if (formula === undefined) {
      outdated.push({ coordinate: receipt.coordinate, installedCommit: receipt.commit, available: false });
      continue;
    }
    if (formula.commit !== receipt.commit) {
      outdated.push({
        coordinate: receipt.coordinate,
        installedCommit: receipt.commit,
        availableCommit: formula.commit,
        available: true
      });
    }
  }
  return outdated;
}

function targetRootFromLink(receipt: InstallReceipt, link: InstalledLink): string {
  if (receipt.kind === "skill") {
    return link.source === receipt.cellarPath
      ? path.dirname(path.dirname(link.path))
      : path.dirname(path.dirname(path.dirname(link.path)));
  }
  return path.dirname(path.dirname(link.path));
}

interface TargetPlacement {
  target: TargetName;
  options: LinkOptions;
}

function targetPlacements(receipt: InstallReceipt): TargetPlacement[] {
  if (receipt.operations.length > 0) {
    return receipt.operations.map((operation) => {
      const target = operation.target;
      if (operation.scope !== undefined) {
        return {
          target,
          options: {
            scope: operation.scope,
            ...(operation.root === undefined ? {} : { root: operation.root }),
            ...(operation.projectRoot === undefined ? {} : { projectRoot: operation.projectRoot })
          }
        };
      }
      if (receipt.kind === "workflow" || receipt.kind === "prompt") {
        return { target, options: { root: path.dirname(path.dirname(path.dirname(operation.destination))) } };
      }
      if (receipt.kind === "skill" || receipt.kind === "agent") {
        return { target, options: { root: path.dirname(path.dirname(operation.destination)) } };
      }
      if (receipt.kind === "instruction" && target === "claude-code") {
        return { target, options: { root: path.dirname(path.dirname(operation.destination)) } };
      }
      if (receipt.kind === "mcp" && target === "claude-code") {
        return path.basename(operation.destination) === ".claude.json"
          ? { target, options: {} }
          : { target, options: { root: path.dirname(operation.destination) } };
      }
      return { target, options: { root: path.dirname(operation.destination) } };
    });
  }
  return receipt.links.map((link) => ({
    target: link.target,
    options: { root: targetRootFromLink(receipt, link) }
  }));
}

async function restoreReceipt(home: string, receipt: InstallReceipt, placements: TargetPlacement[]): Promise<void> {
  const restored: InstallReceipt = { ...receipt, targets: [], links: [], operations: [] };
  await writeReceipt(home, restored);
  for (const placement of placements) {
    await linkFormula(home, restored.coordinate, placement.target, placement.options);
  }
}

async function upgradeOne(home: string, receipt: InstallReceipt, formula: CatalogFormula): Promise<UpgradeResult> {
  await verifyReceiptIntegrity(receipt);
  const placements = targetPlacements(receipt);
  if (placements.length > 0) await assertTapTrusted(home, receipt.tap);

  if (receipt.operations.length > 0) {
    for (const operation of [...receipt.operations].reverse()) await removeTargetOperation(operation, true);
  } else {
    for (const link of receipt.links) {
      await captureTransactionPath(link.path);
      await rm(link.path, { force: true });
      await markTransactionPath(link.path);
    }
  }
  await captureTransactionPath(resolveReceiptPath(home, receipt.coordinate));
  await rm(resolveReceiptPath(home, receipt.coordinate), { force: true });

  let replacement: InstallReceipt | undefined;
  try {
    replacement = await installCatalogFormula(home, formula, receipt.requested);
    for (const placement of placements) {
      await linkFormula(home, replacement.coordinate, placement.target, placement.options);
    }
    await captureTransactionPath(receipt.cellarPath);
    await rm(receipt.cellarPath, { recursive: true, force: true });
    return { coordinate: receipt.coordinate, before: receipt.commit, after: formula.commit };
  } catch (error) {
    if (replacement !== undefined) {
      await uninstallFormula(home, replacement.coordinate, { force: true }).catch(() => undefined);
    }
    await restoreReceipt(home, receipt, placements);
    throw error;
  }
}

function orderForUpgrade(formulas: CatalogFormula[]): CatalogFormula[] {
  const candidates = new Map(formulas.map((formula) => [formula.coordinate, formula]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: CatalogFormula[] = [];

  function visit(formula: CatalogFormula): void {
    if (visiting.has(formula.coordinate)) throw new HarnessBrewError(`Dependency cycle detected during upgrade: ${formula.coordinate}`);
    if (visited.has(formula.coordinate)) return;
    visiting.add(formula.coordinate);
    for (const dependency of formula.dependencies) {
      const candidate = candidates.get(dependency);
      if (candidate !== undefined) visit(candidate);
    }
    visiting.delete(formula.coordinate);
    visited.add(formula.coordinate);
    ordered.push(formula);
  }

  formulas.forEach(visit);
  return ordered;
}

export async function upgradeFormulas(home: string, requested?: string): Promise<UpgradeResult[]> {
  const installed = await listInstalled(home);
  const catalog = await loadCatalog(home);
  const installedByCoordinate = new Map(installed.map((receipt) => [receipt.coordinate, receipt]));
  let selected = catalog.filter((formula) => {
    const receipt = installedByCoordinate.get(formula.coordinate);
    return receipt !== undefined && receipt.commit !== formula.commit;
  });

  if (requested !== undefined) {
    const roots = requested.split("/").length === 3
      ? catalog.filter((formula) => formula.coordinate === requested)
      : catalog.filter((formula) => formula.name === requested);
    if (roots.length !== 1) {
      throw new HarnessBrewError(roots.length === 0 ? `Formula not found: ${requested}` : `Formula name is ambiguous: ${requested}`);
    }
    const closure = new Set<string>();
    const byCoordinate = new Map(catalog.map((formula) => [formula.coordinate, formula]));
    function collect(formula: CatalogFormula): void {
      if (closure.has(formula.coordinate)) return;
      closure.add(formula.coordinate);
      formula.dependencies.forEach((dependency) => {
        const dependencyFormula = byCoordinate.get(dependency);
        if (dependencyFormula !== undefined) collect(dependencyFormula);
      });
    }
    collect(roots[0] as CatalogFormula);
    selected = selected.filter((formula) => closure.has(formula.coordinate));
  }

  const results: UpgradeResult[] = [];
  for (const formula of orderForUpgrade(selected)) {
    const receipt = installedByCoordinate.get(formula.coordinate);
    if (receipt !== undefined) results.push(await upgradeOne(home, receipt, formula));
  }
  return results;
}
