import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink
} from "node:fs/promises";
import path from "node:path";
import { HarnessBrewError } from "./errors.js";
import { withTargetLock } from "./locks.js";

type SnapshotKind = "missing" | "file" | "directory" | "symlink";

interface JournalEntry {
  path: string;
  kind: SnapshotKind;
  backup?: string;
  linkTarget?: string;
  mode?: number;
  expected?: PathFingerprint;
}

interface PathFingerprint {
  kind: SnapshotKind;
  digest?: string;
  linkTarget?: string;
}

interface JournalRecord {
  schemaVersion: 1;
  id: string;
  label: string;
  home: string;
  createdAt: string;
  entries: JournalEntry[];
}

interface ActiveJournal {
  directory: string;
  record: JournalRecord;
  captured: Set<string>;
}

export interface RecoveryResult {
  recovered: string[];
}

const activeJournal = new AsyncLocalStorage<ActiveJournal>();

export function transactionsRoot(home: string): string {
  return path.join(path.resolve(home), "transactions");
}

function journalPath(directory: string): string {
  return path.join(directory, "journal.json");
}

function safeTransactionPath(home: string, candidate: string): boolean {
  const resolvedHome = path.resolve(home);
  const resolved = path.resolve(candidate);
  const root = path.parse(resolved).root;
  if (resolved === root || resolved === resolvedHome) return false;
  const journalRoot = transactionsRoot(resolvedHome);
  const journalRelative = path.relative(journalRoot, resolved);
  if (journalRelative === "" || (journalRelative !== ".." && !journalRelative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(journalRelative))) return false;
  const homeRelative = path.relative(resolved, resolvedHome);
  return homeRelative !== "" && (homeRelative === ".." || homeRelative.startsWith(`..${path.sep}`));
}

function validBackup(candidate: unknown): candidate is string {
  return typeof candidate === "string" && /^backups[\\/][0-9]+$/u.test(candidate);
}

function parseJournal(content: string, directory: string, home: string): JournalRecord {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new HarnessBrewError(`Invalid transaction journal: ${journalPath(directory)}`);
  }
  if (typeof value !== "object" || value === null) {
    throw new HarnessBrewError(`Invalid transaction journal: ${journalPath(directory)}`);
  }
  const record = value as JournalRecord;
  const validEntry = (entry: unknown, index: number): entry is JournalEntry => {
    if (typeof entry !== "object" || entry === null) return false;
    const item = entry as JournalEntry;
    if (typeof item.path !== "string" || !path.isAbsolute(item.path) || !safeTransactionPath(home, item.path)
      || !["missing", "file", "directory", "symlink"].includes(item.kind)) return false;
    if ((item.kind === "file" || item.kind === "directory")
      && (!validBackup(item.backup) || item.backup !== path.join("backups", String(index)))) return false;
    if (item.kind === "symlink" && typeof item.linkTarget !== "string") return false;
    const expected = item.expected;
    const validExpected = expected === undefined || (typeof expected === "object" && expected !== null
      && ["missing", "file", "directory", "symlink"].includes(expected.kind)
      && (expected.digest === undefined || (typeof expected.digest === "string" && /^[0-9a-f]{64}$/u.test(expected.digest)))
      && (expected.linkTarget === undefined || typeof expected.linkTarget === "string"));
    return validExpected && (item.mode === undefined
      || (Number.isInteger(item.mode) && item.mode >= 0 && item.mode <= 0o777));
  };
  if (record.schemaVersion !== 1 || record.id !== path.basename(directory)
    || typeof record.label !== "string" || record.label === ""
    || path.resolve(record.home) !== path.resolve(home)
    || typeof record.createdAt !== "string" || Number.isNaN(Date.parse(record.createdAt))
    || !Array.isArray(record.entries) || !record.entries.every(validEntry)) {
    throw new HarnessBrewError(`Invalid transaction journal: ${journalPath(directory)}`);
  }
  return record;
}

async function writeJournal(active: ActiveJournal): Promise<void> {
  const destination = journalPath(active.directory);
  const temporaryPath = `${destination}.${process.pid}.tmp`;
  await mkdir(active.directory, { recursive: true });
  const handle = await open(temporaryPath, "w");
  try {
    await handle.writeFile(`${JSON.stringify(active.record, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, destination);
}

async function metadata(filePath: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function fingerprint(filePath: string): Promise<PathFingerprint> {
  const current = await metadata(filePath);
  if (current === undefined) return { kind: "missing" };
  if (current.isSymbolicLink()) return { kind: "symlink", linkTarget: await readlink(filePath) };
  if (current.isFile()) {
    return { kind: "file", digest: createHash("sha256").update(await readFile(filePath)).digest("hex") };
  }
  if (current.isDirectory()) {
    const hash = createHash("sha256");
    async function visit(directory: string): Promise<void> {
      const entries = (await readdir(directory, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const child = path.join(directory, entry.name);
        const relative = path.relative(filePath, child);
        if (entry.isDirectory()) {
          hash.update(`d:${relative}\0`);
          await visit(child);
        } else if (entry.isFile()) {
          hash.update(`f:${relative}\0`);
          hash.update(await readFile(child));
        } else if (entry.isSymbolicLink()) {
          hash.update(`l:${relative}:${await readlink(child)}\0`);
        } else {
          throw new HarnessBrewError(`Unsupported transaction path type: ${child}`);
        }
      }
    }
    await visit(filePath);
    return { kind: "directory", digest: hash.digest("hex") };
  }
  throw new HarnessBrewError(`Unsupported transaction path type: ${filePath}`);
}

function sameFingerprint(left: PathFingerprint, right: PathFingerprint): boolean {
  return left.kind === right.kind && left.digest === right.digest && left.linkTarget === right.linkTarget;
}

export async function captureTransactionPath(candidate: string): Promise<void> {
  const active = activeJournal.getStore();
  if (active === undefined) return;
  const target = path.resolve(candidate);
  if (!safeTransactionPath(active.record.home, target)) {
    throw new HarnessBrewError(`Unsafe transaction path: ${target}`);
  }
  if (active.captured.has(target)) return;
  const current = await metadata(target);
  const entry: JournalEntry = current === undefined
    ? { path: target, kind: "missing" }
    : current.isSymbolicLink()
      ? { path: target, kind: "symlink", linkTarget: await readlink(target), mode: Number(current.mode) & 0o777 }
      : current.isFile()
        ? { path: target, kind: "file", backup: path.join("backups", String(active.record.entries.length)), mode: Number(current.mode) & 0o777 }
        : current.isDirectory()
          ? { path: target, kind: "directory", backup: path.join("backups", String(active.record.entries.length)), mode: Number(current.mode) & 0o777 }
          : (() => { throw new HarnessBrewError(`Unsupported transaction path type: ${target}`); })();
  if (entry.backup !== undefined) {
    const backupPath = path.join(active.directory, entry.backup);
    await mkdir(path.dirname(backupPath), { recursive: true });
    if (entry.kind === "directory") {
      await cp(target, backupPath, { recursive: true, errorOnExist: true, preserveTimestamps: true });
    } else {
      await copyFile(target, backupPath);
    }
  }
  active.record.entries.push(entry);
  active.captured.add(target);
  await writeJournal(active);
}

export async function markTransactionPath(candidate: string): Promise<void> {
  const active = activeJournal.getStore();
  if (active === undefined) return;
  const target = path.resolve(candidate);
  const entry = active.record.entries.find((item) => item.path === target);
  if (entry === undefined) throw new HarnessBrewError(`Transaction path was not captured before mutation: ${target}`);
  entry.expected = await fingerprint(target);
  await writeJournal(active);
}

export async function captureMissingParents(candidate: string): Promise<string[]> {
  if (activeJournal.getStore() === undefined) return [];
  let current = path.dirname(path.resolve(candidate));
  const root = path.parse(current).root;
  const captured: string[] = [];
  while (current !== root && await metadata(current) === undefined) {
    await captureTransactionPath(current);
    captured.push(current);
    current = path.dirname(current);
  }
  return captured;
}

async function restoreEntry(directory: string, entry: JournalEntry): Promise<void> {
  await rm(entry.path, { recursive: true, force: true });
  if (entry.kind === "missing") return;
  await mkdir(path.dirname(entry.path), { recursive: true });
  if (entry.kind === "symlink") {
    await symlink(entry.linkTarget as string, entry.path);
  } else if (entry.kind === "directory") {
    await cp(path.join(directory, entry.backup as string), entry.path, {
      recursive: true,
      errorOnExist: true,
      preserveTimestamps: true
    });
  } else {
    await copyFile(path.join(directory, entry.backup as string), entry.path);
  }
  if (entry.mode !== undefined && entry.kind !== "symlink") await chmod(entry.path, entry.mode);
}

async function originalFingerprint(directory: string, entry: JournalEntry): Promise<PathFingerprint> {
  if (entry.kind === "missing") return { kind: "missing" };
  if (entry.kind === "symlink") return { kind: "symlink", linkTarget: entry.linkTarget as string };
  return fingerprint(path.join(directory, entry.backup as string));
}

async function preflightRollback(directory: string, record: JournalRecord): Promise<void> {
  const seen = new Set<string>();
  for (const entry of record.entries) {
    if (seen.has(entry.path)) throw new HarnessBrewError(`Invalid transaction journal: ${journalPath(directory)}`);
    seen.add(entry.path);
    const original = await originalFingerprint(directory, entry).catch(() => undefined);
    if (original === undefined) throw new HarnessBrewError(`Incomplete transaction backup: ${entry.path}`);
    const relativeToHome = path.relative(record.home, entry.path);
    const external = relativeToHome === ".." || relativeToHome.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToHome);
    if (external) {
      const current = await fingerprint(entry.path);
      if (entry.expected === undefined) {
        if (!sameFingerprint(current, original)) {
          throw new HarnessBrewError(`Transaction recovery conflict: ${entry.path}`);
        }
      } else if (!sameFingerprint(current, entry.expected) && !sameFingerprint(current, original)) {
        throw new HarnessBrewError(`Transaction recovery conflict: ${entry.path}`);
      }
    }
  }
}

async function rollback(directory: string, record: JournalRecord): Promise<void> {
  await preflightRollback(directory, record);
  for (const entry of [...record.entries].reverse()) {
    await withTargetLock(entry.path, () => restoreEntry(directory, entry));
  }
  await rm(directory, { recursive: true, force: true });
}

export async function recoverTransactions(home: string): Promise<RecoveryResult> {
  const resolvedHome = path.resolve(home);
  const root = transactionsRoot(resolvedHome);
  let directories: string[];
  try {
    directories = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { recovered: [] };
    throw error;
  }
  const recovered: string[] = [];
  for (const directory of directories) {
    let content: string;
    try {
      content = await readFile(journalPath(directory), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        await rm(directory, { recursive: true, force: true });
        continue;
      }
      throw error;
    }
    const record = parseJournal(content, directory, resolvedHome);
    await rollback(directory, record);
    recovered.push(record.label);
  }
  return { recovered };
}

export async function withJournalTransaction<T>(
  home: string,
  label: string,
  action: () => Promise<T>
): Promise<T> {
  const resolvedHome = path.resolve(home);
  const existing = activeJournal.getStore();
  if (existing !== undefined) {
    if (existing.record.home !== resolvedHome) {
      throw new HarnessBrewError("Nested transactions must use the same HarnessBrew home.");
    }
    return action();
  }
  await recoverTransactions(resolvedHome);
  const id = randomUUID();
  const directory = path.join(transactionsRoot(resolvedHome), id);
  const active: ActiveJournal = {
    directory,
    record: {
      schemaVersion: 1,
      id,
      label,
      home: resolvedHome,
      createdAt: new Date().toISOString(),
      entries: []
    },
    captured: new Set()
  };
  await writeJournal(active);
  return activeJournal.run(active, async () => {
    try {
      const result = await action();
      await rm(directory, { recursive: true, force: true });
      return result;
    } catch (error) {
      await rollback(directory, active.record);
      throw error;
    }
  });
}
