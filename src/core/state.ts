import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { HarnessBrewError } from "./errors.js";
import { resolveStatePath } from "./paths.js";

export interface TapRecord {
  name: string;
  url: string;
  commit: string;
  addedAt: string;
  updatedAt: string;
  ref?: string;
}

export interface HarnessState {
  schemaVersion: 1;
  taps: Record<string, TapRecord>;
}

export function emptyState(): HarnessState {
  return { schemaVersion: 1, taps: {} };
}

export async function readState(home: string): Promise<HarnessState> {
  const statePath = resolveStatePath(home);
  let content: string;
  try {
    content = await readFile(statePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyState();
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new HarnessBrewError(`Invalid HarnessBrew state file: ${statePath}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { schemaVersion?: unknown }).schemaVersion !== 1 ||
    typeof (parsed as { taps?: unknown }).taps !== "object" ||
    (parsed as { taps?: unknown }).taps === null
  ) {
    throw new HarnessBrewError(`Unsupported HarnessBrew state file: ${statePath}`);
  }

  return parsed as HarnessState;
}

export async function writeState(home: string, state: HarnessState): Promise<void> {
  const statePath = resolveStatePath(home);
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporaryPath, statePath);
}
