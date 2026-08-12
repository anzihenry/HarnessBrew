import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { HarnessBrewError } from "./errors.js";
import { resolveGitCommit, runGit } from "./git.js";
import { validateTapRepository } from "./formulas.js";
import { assertTapName, resolveTapPath } from "./paths.js";
import { readState, type TapRecord, writeState } from "./state.js";
import { captureMissingParents, captureTransactionPath } from "./journal.js";

export interface AddTapOptions {
  ref?: string;
}

export interface TapUpdate {
  name: string;
  before: string;
  after: string;
  changed: boolean;
}

export async function listTaps(home: string): Promise<TapRecord[]> {
  const state = await readState(home);
  return Object.values(state.taps).sort((left, right) => left.name.localeCompare(right.name));
}

export async function addTap(
  home: string,
  name: string,
  url: string,
  options: AddTapOptions = {}
): Promise<TapRecord> {
  assertTapName(name);
  if (url.trim() === "") {
    throw new HarnessBrewError("Tap Git URL must not be empty.");
  }

  const state = await readState(home);
  if (state.taps[name] !== undefined) {
    throw new HarnessBrewError(`Tap already exists: ${name}`);
  }

  const destination = resolveTapPath(home, name);
  await captureMissingParents(destination);
  await captureTransactionPath(destination);
  await mkdir(path.dirname(destination), { recursive: true });

  try {
    await runGit(["clone", "--quiet", "--", url, destination]);
    const commit = await resolveGitCommit(destination, options.ref);
    await runGit(["checkout", "--quiet", "--detach", commit], destination);
    await validateTapRepository(destination);
    const timestamp = new Date().toISOString();
    const record: TapRecord = {
      name,
      url,
      commit,
      addedAt: timestamp,
      updatedAt: timestamp,
      ...(options.ref === undefined ? {} : { ref: options.ref })
    };
    state.taps[name] = record;
    await writeState(home, state);
    return record;
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  }
}

export async function updateTaps(home: string, requestedName?: string): Promise<TapUpdate[]> {
  if (requestedName !== undefined) {
    assertTapName(requestedName);
  }
  const state = await readState(home);
  const records = requestedName === undefined
    ? Object.values(state.taps)
    : [state.taps[requestedName]].filter((record): record is TapRecord => record !== undefined);

  if (requestedName !== undefined && records.length === 0) {
    throw new HarnessBrewError(`Tap not found: ${requestedName}`);
  }

  const updates: TapUpdate[] = [];
  for (const record of records.sort((left, right) => left.name.localeCompare(right.name))) {
    const repositoryPath = resolveTapPath(home, record.name);
    await captureTransactionPath(repositoryPath);
    await runGit(["fetch", "--quiet", "--prune", "--tags", "origin"], repositoryPath);
    const commit = await resolveGitCommit(repositoryPath, record.ref);
    await runGit(["checkout", "--quiet", "--detach", commit], repositoryPath);
    await validateTapRepository(repositoryPath);
    const before = record.commit;
    record.commit = commit;
    record.updatedAt = new Date().toISOString();
    updates.push({ name: record.name, before, after: commit, changed: before !== commit });
  }

  await writeState(home, state);
  return updates;
}

export async function removeTap(home: string, name: string): Promise<TapRecord> {
  assertTapName(name);
  const state = await readState(home);
  const record = state.taps[name];
  if (record === undefined) {
    throw new HarnessBrewError(`Tap not found: ${name}`);
  }

  const repositoryPath = resolveTapPath(home, name);
  await captureTransactionPath(repositoryPath);
  await rm(repositoryPath, { recursive: true, force: true });
  delete state.taps[name];
  await writeState(home, state);
  return record;
}

export async function checkoutTap(home: string, name: string, commit: string): Promise<TapRecord> {
  assertTapName(name);
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new HarnessBrewError(`Invalid Git commit: ${commit}`);
  const state = await readState(home);
  const record = state.taps[name];
  if (record === undefined) throw new HarnessBrewError(`Tap not found: ${name}`);
  const repositoryPath = resolveTapPath(home, name);
  await captureTransactionPath(repositoryPath);
  await runGit(["fetch", "--quiet", "--prune", "--tags", "origin"], repositoryPath);
  const resolved = await resolveGitCommit(repositoryPath, commit);
  await runGit(["checkout", "--quiet", "--detach", resolved], repositoryPath);
  await validateTapRepository(repositoryPath);
  record.commit = resolved;
  record.updatedAt = new Date().toISOString();
  await writeState(home, state);
  return record;
}
