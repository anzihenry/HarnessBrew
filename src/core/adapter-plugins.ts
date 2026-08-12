import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { HarnessBrewError } from "./errors.js";
import { captureMissingParents, captureTransactionPath } from "./journal.js";
import { resolveAdapterPluginsPath } from "./paths.js";
import { registerTargetAdapter } from "./targets/registry.js";
import type { TargetAdapter } from "./targets/types.js";

export interface AdapterPluginRecord {
  module: string;
  name: string;
  version: string;
  apiVersion: 1;
  addedAt: string;
}

interface AdapterPluginState {
  schemaVersion: 1;
  adapters: AdapterPluginRecord[];
}

interface AdapterPluginModule {
  default?: unknown;
  adapter?: unknown;
}

const packageSpecifierPattern = /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/u;

function normalizedSpecifier(specifier: string): string {
  if (path.isAbsolute(specifier)) return pathToFileURL(path.resolve(specifier)).href;
  if (specifier.startsWith("file://")) {
    try {
      return new URL(specifier).href;
    } catch {
      throw new HarnessBrewError(`Invalid Adapter module specifier: ${specifier}`);
    }
  }
  if (!packageSpecifierPattern.test(specifier)) {
    throw new HarnessBrewError(
      `Invalid Adapter module specifier: ${specifier}. Use an npm package name, absolute path, or file URL.`
    );
  }
  return specifier;
}

function validRecord(candidate: unknown): candidate is AdapterPluginRecord {
  if (typeof candidate !== "object" || candidate === null) return false;
  const record = candidate as Partial<AdapterPluginRecord>;
  return typeof record.module === "string" && typeof record.name === "string"
    && typeof record.version === "string" && record.apiVersion === 1
    && typeof record.addedAt === "string" && !Number.isNaN(Date.parse(record.addedAt));
}

async function readPluginState(home: string): Promise<AdapterPluginState> {
  const filePath = resolveAdapterPluginsPath(home);
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { schemaVersion: 1, adapters: [] };
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new HarnessBrewError(`Invalid Adapter plugin state file: ${filePath}`);
  }
  if (typeof value !== "object" || value === null
    || (value as { schemaVersion?: unknown }).schemaVersion !== 1
    || !Array.isArray((value as { adapters?: unknown }).adapters)
    || !(value as { adapters: unknown[] }).adapters.every(validRecord)) {
    throw new HarnessBrewError(`Unsupported Adapter plugin state file: ${filePath}`);
  }
  const state = value as AdapterPluginState;
  if (new Set(state.adapters.map((record) => record.name)).size !== state.adapters.length
    || new Set(state.adapters.map((record) => record.module)).size !== state.adapters.length) {
    throw new HarnessBrewError(`Unsupported Adapter plugin state file: ${filePath}`);
  }
  return state;
}

async function writePluginState(home: string, state: AdapterPluginState): Promise<void> {
  const filePath = resolveAdapterPluginsPath(home);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await captureMissingParents(filePath);
  await captureTransactionPath(filePath);
  await captureTransactionPath(temporaryPath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

async function importAdapter(specifier: string): Promise<TargetAdapter> {
  let loaded: AdapterPluginModule;
  try {
    loaded = await import(specifier) as AdapterPluginModule;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new HarnessBrewError(`Cannot load Adapter module ${specifier}: ${detail}`);
  }
  const candidate = loaded.default ?? loaded.adapter;
  if (typeof candidate !== "object" || candidate === null) {
    throw new HarnessBrewError(`Adapter module ${specifier} must export a default Adapter or named 'adapter'.`);
  }
  return candidate as TargetAdapter;
}

function verifyIdentity(record: AdapterPluginRecord, adapter: TargetAdapter): void {
  if (adapter.name !== record.name || adapter.version !== record.version || adapter.apiVersion !== record.apiVersion) {
    throw new HarnessBrewError(
      `Adapter module ${record.module} changed identity from ${record.name}@${record.version}; remove and add it again after review.`
    );
  }
}

export async function listAdapterPlugins(home: string): Promise<AdapterPluginRecord[]> {
  return (await readPluginState(home)).adapters.map((record) => ({ ...record }));
}

export async function addAdapterPlugin(home: string, moduleSpecifier: string): Promise<AdapterPluginRecord> {
  const specifier = normalizedSpecifier(moduleSpecifier);
  const state = await readPluginState(home);
  if (state.adapters.some((record) => record.module === specifier)) {
    throw new HarnessBrewError(`Adapter module is already added: ${specifier}`);
  }
  const adapter = await importAdapter(specifier);
  const unregister = registerTargetAdapter(adapter);
  try {
    if (state.adapters.some((record) => record.name === adapter.name)) {
      throw new HarnessBrewError(`Adapter plugin is already added for target: ${adapter.name}`);
    }
    const record: AdapterPluginRecord = {
      module: specifier,
      name: adapter.name,
      version: adapter.version,
      apiVersion: adapter.apiVersion,
      addedAt: new Date().toISOString()
    };
    state.adapters.push(record);
    state.adapters.sort((left, right) => left.name.localeCompare(right.name));
    await writePluginState(home, state);
    return { ...record };
  } finally {
    unregister();
  }
}

export async function removeAdapterPlugin(home: string, name: string): Promise<AdapterPluginRecord> {
  const state = await readPluginState(home);
  const index = state.adapters.findIndex((record) => record.name === name);
  const record = state.adapters[index];
  if (record === undefined) throw new HarnessBrewError(`Adapter plugin not found: ${name}`);
  state.adapters.splice(index, 1);
  await writePluginState(home, state);
  return { ...record };
}

export async function loadAdapterPlugins(home: string): Promise<() => void> {
  const records = await listAdapterPlugins(home);
  const unregister: Array<() => void> = [];
  try {
    for (const record of records) {
      const adapter = await importAdapter(record.module);
      verifyIdentity(record, adapter);
      unregister.push(registerTargetAdapter(adapter));
    }
  } catch (error) {
    unregister.reverse().forEach((dispose) => dispose());
    throw error;
  }
  return () => unregister.reverse().forEach((dispose) => dispose());
}
