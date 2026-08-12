import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { HarnessBrewError } from "./errors.js";
import { getFormula, loadCatalog, type CatalogFormula } from "./formulas.js";
import { resolveCellarPath, resolveReceiptPath } from "./paths.js";
import type { TargetScope } from "./targets/types.js";

export interface InstalledFile {
  path: string;
  sha256: string;
}

export interface InstalledLink extends InstalledFile {
  source: string;
  target: string;
}

export type InstalledOperationType =
  | "symlink-directory"
  | "symlink-file"
  | "render-file"
  | "merge-config"
  | "managed-block";

export interface InstalledOperation {
  id: string;
  type: InstalledOperationType;
  target: string;
  destination: string;
  source?: string;
  beforeDigest?: string;
  installedDigest?: string;
  ownedKeys?: string[];
  marker?: string;
  managedPrefix?: string;
  configFormat?: "json" | "toml-block";
  scope?: TargetScope;
  root?: string;
  projectRoot?: string;
  createdDirectories: string[];
}

export interface InstallReceipt {
  schemaVersion: 2;
  coordinate: string;
  kind: string;
  description: string;
  tap: string;
  commit: string;
  cellarPath: string;
  entry: string;
  dependencies: string[];
  conflicts: string[];
  requested: boolean;
  files: InstalledFile[];
  supportedTargets: string[];
  targets: string[];
  links: InstalledLink[];
  operations: InstalledOperation[];
  installedAt: string;
}

export interface UninstallOptions {
  force?: boolean;
}

async function walkFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, entryPath));
    else if (entry.isFile()) files.push(path.relative(root, entryPath));
    else throw new HarnessBrewError(`Unsupported file type in formula: ${entryPath}`);
  }
  return files;
}

async function digestFile(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function inventory(root: string): Promise<InstalledFile[]> {
  const files = await walkFiles(root);
  return Promise.all(files.map(async (relativePath) => ({
    path: relativePath,
    sha256: await digestFile(path.join(root, relativePath))
  })));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function normalizeReceipt(value: unknown, receiptPath: string, expectedCoordinate?: string): InstallReceipt {
  if (typeof value !== "object" || value === null) throw new HarnessBrewError(`Invalid install receipt: ${receiptPath}`);
  const receipt = value as Omit<InstallReceipt, "schemaVersion" | "operations"> & {
    schemaVersion?: unknown;
    operations?: InstalledOperation[];
  };
  if ((receipt.schemaVersion !== 1 && receipt.schemaVersion !== 2)
    || typeof receipt.coordinate !== "string"
    || (expectedCoordinate !== undefined && receipt.coordinate !== expectedCoordinate)
    || !Array.isArray(receipt.links)) {
    throw new HarnessBrewError(`Invalid install receipt: ${receiptPath}`);
  }
  const operations = receipt.schemaVersion === 2 && Array.isArray(receipt.operations)
    ? receipt.operations
    : receipt.links.map((link, index): InstalledOperation => ({
      id: `legacy:${receipt.coordinate}:${link.target}:${index}`,
      type: "symlink-file",
      target: link.target,
      destination: link.path,
      source: link.source,
      installedDigest: link.sha256,
      createdDirectories: []
    }));
  const description = typeof receipt.description === "string" && receipt.description.trim() !== ""
    ? receipt.description
    : receipt.coordinate.split("/").at(-1) ?? receipt.coordinate;
  return { ...receipt, description, schemaVersion: 2, operations } as InstallReceipt;
}

export async function readReceipt(home: string, coordinate: string): Promise<InstallReceipt | undefined> {
  const receiptPath = resolveReceiptPath(home, coordinate);
  let content: string;
  try {
    content = await readFile(receiptPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    return normalizeReceipt(JSON.parse(content), receiptPath, coordinate);
  } catch {
    throw new HarnessBrewError(`Invalid install receipt: ${receiptPath}`);
  }
}

export async function writeReceipt(home: string, receipt: InstallReceipt): Promise<void> {
  const receiptPath = resolveReceiptPath(home, receipt.coordinate);
  await mkdir(path.dirname(receiptPath), { recursive: true });
  const temporaryPath = `${receiptPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await rename(temporaryPath, receiptPath);
}

export async function listInstalled(home: string): Promise<InstallReceipt[]> {
  const receiptsRoot = path.join(home, "receipts");
  if (!(await pathExists(receiptsRoot))) return [];
  const receiptPaths = (await walkFiles(receiptsRoot)).filter((file) => file.endsWith(".json"));
  const receipts: InstallReceipt[] = [];
  for (const relativePath of receiptPaths) {
    const content = await readFile(path.join(receiptsRoot, relativePath), "utf8");
    receipts.push(normalizeReceipt(JSON.parse(content), path.join(receiptsRoot, relativePath)));
  }
  return receipts.sort((left, right) => left.coordinate.localeCompare(right.coordinate));
}

export async function resolveDependencies(home: string, root: CatalogFormula): Promise<CatalogFormula[]> {
  const catalog = await loadCatalog(home);
  const formulas = new Map(catalog.map((formula) => [formula.coordinate, formula]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: CatalogFormula[] = [];

  function visit(formula: CatalogFormula, trail: string[]): void {
    if (visiting.has(formula.coordinate)) {
      throw new HarnessBrewError(`Dependency cycle detected: ${[...trail, formula.coordinate].join(" -> ")}`);
    }
    if (visited.has(formula.coordinate)) return;
    visiting.add(formula.coordinate);
    for (const dependencyCoordinate of formula.dependencies) {
      const dependency = formulas.get(dependencyCoordinate);
      if (dependency === undefined) {
        throw new HarnessBrewError(`Dependency not found: ${formula.coordinate} -> ${dependencyCoordinate}`);
      }
      visit(dependency, [...trail, formula.coordinate]);
    }
    visiting.delete(formula.coordinate);
    visited.add(formula.coordinate);
    ordered.push(formula);
  }

  visit(root, []);
  return ordered;
}

function assertNoConflicts(formulas: CatalogFormula[], installed: InstallReceipt[]): void {
  const requested = new Set(formulas.map((formula) => formula.coordinate));
  const installedCoordinates = new Set(installed.map((receipt) => receipt.coordinate));
  for (const formula of formulas) {
    for (const conflict of formula.conflicts) {
      if (requested.has(conflict) || installedCoordinates.has(conflict)) {
        throw new HarnessBrewError(`Formula conflict: ${formula.coordinate} conflicts with ${conflict}`);
      }
    }
    const reciprocal = installed.find((receipt) => receipt.conflicts.includes(formula.coordinate));
    if (reciprocal !== undefined) {
      throw new HarnessBrewError(`Formula conflict: ${reciprocal.coordinate} conflicts with ${formula.coordinate}`);
    }
  }
}

export async function installCatalogFormula(
  home: string,
  formula: CatalogFormula,
  requested: boolean
): Promise<InstallReceipt> {
  const existing = await readReceipt(home, formula.coordinate);
  if (existing !== undefined) {
    if (requested && !existing.requested) {
      existing.requested = true;
      await writeReceipt(home, existing);
    }
    return existing;
  }

  const cellarPath = resolveCellarPath(home, formula.coordinate, formula.commit);
  const temporaryPath = `${cellarPath}.${process.pid}.tmp`;
  await mkdir(path.dirname(cellarPath), { recursive: true });
  await rm(temporaryPath, { recursive: true, force: true });
  try {
    await cp(formula.directory, temporaryPath, { recursive: true, errorOnExist: true });
    await rename(temporaryPath, cellarPath);
    const receipt: InstallReceipt = {
      schemaVersion: 2,
      coordinate: formula.coordinate,
      kind: formula.kind,
      description: formula.description,
      tap: formula.tap,
      commit: formula.commit,
      cellarPath,
      entry: formula.entry,
      dependencies: formula.dependencies,
      conflicts: formula.conflicts,
      requested,
      files: await inventory(cellarPath),
      supportedTargets: formula.targets,
      targets: [],
      links: [],
      operations: [],
      installedAt: new Date().toISOString()
    };
    await writeReceipt(home, receipt);
    return receipt;
  } catch (error) {
    await rm(temporaryPath, { recursive: true, force: true });
    await rm(cellarPath, { recursive: true, force: true });
    await rm(resolveReceiptPath(home, formula.coordinate), { force: true });
    throw error;
  }
}

export async function installFormula(home: string, nameOrCoordinate: string): Promise<InstallReceipt[]> {
  const root = await getFormula(home, nameOrCoordinate);
  if (root.deprecated !== undefined) {
    throw new HarnessBrewError(`Formula is deprecated: ${root.coordinate}: ${root.deprecated}`);
  }
  const formulas = await resolveDependencies(home, root);
  const installed = await listInstalled(home);
  assertNoConflicts(formulas, installed);
  const receipts: InstallReceipt[] = [];
  const created: InstallReceipt[] = [];
  try {
    for (const formula of formulas) {
      const existed = await readReceipt(home, formula.coordinate) !== undefined;
      const receipt = await installCatalogFormula(home, formula, formula.coordinate === root.coordinate);
      receipts.push(receipt);
      if (!existed) created.push(receipt);
    }
    return receipts;
  } catch (error) {
    for (const receipt of created.reverse()) {
      await rm(receipt.cellarPath, { recursive: true, force: true });
      await rm(resolveReceiptPath(home, receipt.coordinate), { force: true });
    }
    throw error;
  }
}

async function verifyReceiptFiles(receipt: InstallReceipt): Promise<void> {
  for (const file of receipt.files) {
    const filePath = path.join(receipt.cellarPath, file.path);
    if (!(await pathExists(filePath)) || await digestFile(filePath) !== file.sha256) {
      throw new HarnessBrewError(`Installed files were modified for ${receipt.coordinate}: ${file.path}`);
    }
  }
}

export async function verifyCellarIntegrity(receipt: InstallReceipt): Promise<void> {
  await verifyReceiptFiles(receipt);
}

async function verifyReceiptLinks(receipt: InstallReceipt): Promise<void> {
  if (receipt.operations.length > 0) {
    const { verifyTargetOperation } = await import("./targets/transaction.js");
    for (const operation of receipt.operations) await verifyTargetOperation(operation);
    return;
  }
  for (const link of receipt.links) {
    try {
      const metadata = await lstat(link.path);
      if (!metadata.isSymbolicLink() || path.resolve(path.dirname(link.path), await readlink(link.path)) !== link.source) {
        throw new Error("link target changed");
      }
      if (await digestFile(link.source) !== link.sha256) throw new Error("source changed");
    } catch {
      throw new HarnessBrewError(`Installed target was modified for ${receipt.coordinate}: ${link.path}`);
    }
  }
}

export async function verifyReceiptIntegrity(receipt: InstallReceipt): Promise<void> {
  await verifyReceiptFiles(receipt);
  await verifyReceiptLinks(receipt);
}

export async function uninstallFormula(
  home: string,
  nameOrCoordinate: string,
  options: UninstallOptions = {}
): Promise<InstallReceipt> {
  const installed = await listInstalled(home);
  const matches = nameOrCoordinate.split("/").length === 3
    ? installed.filter((receipt) => receipt.coordinate === nameOrCoordinate)
    : installed.filter((receipt) => receipt.coordinate.endsWith(`/${nameOrCoordinate}`));
  if (matches.length === 0) throw new HarnessBrewError(`Formula is not installed: ${nameOrCoordinate}`);
  if (matches.length > 1) throw new HarnessBrewError(`Installed formula name is ambiguous: ${nameOrCoordinate}`);
  const receipt = matches[0] as InstallReceipt;
  const dependents = installed.filter((candidate) => candidate.dependencies.includes(receipt.coordinate));
  if (dependents.length > 0 && options.force !== true) {
    throw new HarnessBrewError(
      `Cannot uninstall ${receipt.coordinate}; required by ${dependents.map((item) => item.coordinate).join(", ")}`
    );
  }
  if (options.force !== true) {
    await verifyReceiptIntegrity(receipt);
  }
  if (receipt.operations.length > 0) {
    const { removeTargetOperation } = await import("./targets/transaction.js");
    for (const operation of [...receipt.operations].reverse()) await removeTargetOperation(operation, true);
  } else {
    for (const link of receipt.links) await rm(link.path, { force: true });
  }
  await rm(receipt.cellarPath, { recursive: true, force: true });
  await rm(resolveReceiptPath(home, receipt.coordinate), { force: true });
  return receipt;
}
