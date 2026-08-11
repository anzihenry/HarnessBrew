import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { HarnessBrewError } from "./errors.js";
import { resolveTapPath } from "./paths.js";
import { readState, type TapRecord } from "./state.js";

export const formulaKinds = ["skill", "agent", "workflow", "instruction", "prompt", "mcp", "adapter"] as const;
export type FormulaKind = (typeof formulaKinds)[number];

const kindDirectories: Record<FormulaKind, string> = {
  skill: "skills",
  agent: "agents",
  workflow: "workflows",
  instruction: "instructions",
  prompt: "prompts",
  mcp: "mcp",
  adapter: "adapters"
};

const formulaNamePattern = /^[a-z0-9][a-z0-9-]*$/;
const coordinatePattern = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;

export interface Formula {
  schemaVersion: 1;
  name: string;
  kind: FormulaKind;
  description: string;
  entry: string;
  targets: string[];
  dependencies: string[];
  tags: string[];
  conflicts: string[];
  deprecated?: string;
}

export interface CatalogFormula extends Formula {
  tap: string;
  coordinate: string;
  directory: string;
  commit: string;
}

export interface FormulaSearchOptions {
  kind?: FormulaKind;
  target?: string;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && item.trim() !== "");
}

function requireString(value: unknown, field: string, formulaPath: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HarnessBrewError(`Invalid formula ${field}: ${formulaPath}`);
  }
  return value;
}

async function readJson(filePath: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new HarnessBrewError(`Required file not found: ${filePath}`);
    }
    throw error;
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new HarnessBrewError(`Invalid JSON: ${filePath}`);
  }
}

export async function validateTapRepository(repositoryPath: string): Promise<void> {
  const manifestPath = path.join(repositoryPath, "tap.json");
  const manifest = await readJson(manifestPath);
  if (typeof manifest !== "object" || manifest === null || (manifest as { schemaVersion?: unknown }).schemaVersion !== 1) {
    throw new HarnessBrewError(`Unsupported tap manifest: ${manifestPath}`);
  }
  await scanTap(repositoryPath, { name: "validation/tap", commit: "validation" });
}

function validateFormula(raw: unknown, formulaPath: string, expectedName: string, expectedKind: FormulaKind): Formula {
  if (typeof raw !== "object" || raw === null) {
    throw new HarnessBrewError(`Invalid formula object: ${formulaPath}`);
  }
  const value = raw as Record<string, unknown>;
  if (value.schemaVersion !== 1) {
    throw new HarnessBrewError(`Unsupported formula schema: ${formulaPath}`);
  }
  const name = requireString(value.name, "name", formulaPath);
  if (!formulaNamePattern.test(name) || name !== expectedName) {
    throw new HarnessBrewError(`Formula name must match its directory (${expectedName}): ${formulaPath}`);
  }
  const kind = requireString(value.kind, "kind", formulaPath);
  if (kind !== expectedKind) {
    throw new HarnessBrewError(`Formula kind must match ${expectedKind}: ${formulaPath}`);
  }
  const description = requireString(value.description, "description", formulaPath);
  const entry = requireString(value.entry, "entry", formulaPath);
  if (path.isAbsolute(entry) || entry.split(/[\\/]/u).includes("..")) {
    throw new HarnessBrewError(`Formula entry must stay inside its directory: ${formulaPath}`);
  }
  if (!isStringArray(value.targets) || value.targets.length === 0) {
    throw new HarnessBrewError(`Formula targets must be a non-empty string array: ${formulaPath}`);
  }
  const dependencies = value.dependencies === undefined ? [] : value.dependencies;
  if (!isStringArray(dependencies) || dependencies.some((item) => !coordinatePattern.test(item))) {
    throw new HarnessBrewError(`Formula dependencies must use <owner>/<tap>/<formula>: ${formulaPath}`);
  }
  const tags = value.tags === undefined ? [] : value.tags;
  if (!isStringArray(tags)) {
    throw new HarnessBrewError(`Formula tags must be a string array: ${formulaPath}`);
  }
  const conflicts = value.conflicts === undefined ? [] : value.conflicts;
  if (!isStringArray(conflicts) || conflicts.some((item) => !coordinatePattern.test(item))) {
    throw new HarnessBrewError(`Formula conflicts must use <owner>/<tap>/<formula>: ${formulaPath}`);
  }
  const deprecated = value.deprecated;
  if (deprecated !== undefined && (typeof deprecated !== "string" || deprecated.trim() === "")) {
    throw new HarnessBrewError(`Formula deprecated must be a non-empty string: ${formulaPath}`);
  }

  return {
    schemaVersion: 1,
    name,
    kind: expectedKind,
    description,
    entry,
    targets: [...new Set(value.targets)],
    dependencies: [...new Set(dependencies)],
    tags: [...new Set(tags)],
    conflicts: [...new Set(conflicts)],
    ...(deprecated === undefined ? {} : { deprecated })
  };
}

async function directoryNames(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function scanTap(repositoryPath: string, tap: Pick<TapRecord, "name" | "commit">): Promise<CatalogFormula[]> {
  const formulas: CatalogFormula[] = [];
  const names = new Set<string>();

  for (const kind of formulaKinds) {
    const kindDirectory = path.join(repositoryPath, kindDirectories[kind]);
    for (const name of await directoryNames(kindDirectory)) {
      const formulaDirectory = path.join(kindDirectory, name);
      const formulaPath = path.join(formulaDirectory, "formula.json");
      const formula = validateFormula(await readJson(formulaPath), formulaPath, name, kind);
      if (names.has(name)) {
        throw new HarnessBrewError(`Duplicate formula name in ${tap.name}: ${name}`);
      }
      names.add(name);
      const entryPath = path.resolve(formulaDirectory, formula.entry);
      if (!entryPath.startsWith(`${path.resolve(formulaDirectory)}${path.sep}`)) {
        throw new HarnessBrewError(`Formula entry escapes its directory: ${formulaPath}`);
      }
      try {
        if (!(await stat(entryPath)).isFile()) throw new Error("not a file");
      } catch {
        throw new HarnessBrewError(`Formula entry not found: ${entryPath}`);
      }
      formulas.push({
        ...formula,
        tap: tap.name,
        coordinate: `${tap.name}/${formula.name}`,
        directory: formulaDirectory,
        commit: tap.commit
      });
    }
  }

  return formulas;
}

export async function loadCatalog(home: string): Promise<CatalogFormula[]> {
  const state = await readState(home);
  const formulas: CatalogFormula[] = [];
  for (const tap of Object.values(state.taps).sort((left, right) => left.name.localeCompare(right.name))) {
    formulas.push(...await scanTap(resolveTapPath(home, tap.name), tap));
  }
  return formulas.sort((left, right) => left.coordinate.localeCompare(right.coordinate));
}

export async function searchFormulas(
  home: string,
  query = "",
  options: FormulaSearchOptions = {}
): Promise<CatalogFormula[]> {
  const normalized = query.toLocaleLowerCase();
  return (await loadCatalog(home)).filter((formula) => {
    if (options.kind !== undefined && formula.kind !== options.kind) return false;
    if (options.target !== undefined && !formula.targets.includes(options.target)) return false;
    if (normalized === "") return true;
    return [formula.coordinate, formula.description, formula.kind, ...formula.tags]
      .some((value) => value.toLocaleLowerCase().includes(normalized));
  });
}

export async function getFormula(home: string, nameOrCoordinate: string): Promise<CatalogFormula> {
  const catalog = await loadCatalog(home);
  const matches = nameOrCoordinate.split("/").length === 3
    ? catalog.filter((formula) => formula.coordinate === nameOrCoordinate)
    : catalog.filter((formula) => formula.name === nameOrCoordinate);
  if (matches.length === 0) throw new HarnessBrewError(`Formula not found: ${nameOrCoordinate}`);
  if (matches.length > 1) {
    throw new HarnessBrewError(`Formula name is ambiguous: ${nameOrCoordinate}. Use a full tap coordinate.`);
  }
  return matches[0] as CatalogFormula;
}
