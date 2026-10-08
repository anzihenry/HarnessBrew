import { operationCheckpoint, progress } from "../observability/operation.js";
import { emit, measured } from "../observability/measure.js";
import { randomUUID, createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HarnessError } from "../domain/errors.js";

export type LockCheckpoint = "directory-ready" | "choosing-published" | "ticket-staged" | "ticket-published" | "acquired" | "released";
export interface LockOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  retryMs?: number;
  fault?: (point: LockCheckpoint) => void | Promise<void>;
}
interface Participant {
  version: 1;
  token: string;
  pid: number;
  // null is the bakery algorithm's choosing flag; positive decimal integers are tickets.
  ticket: string | null;
}
const participantName = /^([1-9][0-9]*)-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json(\.tmp)?$/u;
const delay = (milliseconds: number): Promise<void> => new Promise(resolve => setTimeout(resolve, milliseconds));
function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}
function corrupt(file: string): never {
  throw new HarnessError("LOCK_CORRUPT", `Invalid lock participant: ${file}`, { path: file });
}
async function readParticipant(directory: string, name: string): Promise<Participant | undefined> {
  const file = path.join(directory, name), match = participantName.exec(name);
  if (!match || match[3]) return corrupt(file);
  try {
    if (!(await lstat(file)).isFile()) return corrupt(file);
    const value = JSON.parse(await readFile(file, "utf8")) as Participant;
    if (!value || value.version !== 1 || value.token !== match[2] || value.pid !== Number(match[1]) || !Number.isSafeInteger(value.pid)
      || value.ticket !== null && (typeof value.ticket !== "string" || !/^[1-9][0-9]*$/u.test(value.ticket))) return corrupt(file);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    if (error instanceof SyntaxError) return corrupt(file);
    throw error;
  }
}

/**
 * Filesystem bakery lock: every invocation owns a unique, never-reused filename.
 * Publish choosing, choose max(ticket)+1, then wait for earlier (ticket, token) pairs.
 * Directory entries and atomic rename are the shared registers on a local filesystem.
 * The namespace stays in place: releasing/reaping never removes another owner's directory.
 */
export async function withFileLock<T>(lockPath: string, action: () => Promise<T>, options: LockOptions = {}): Promise<T> {
  const check = () => { operationCheckpoint(); if (options.signal?.aborted) throw new HarnessError("OPERATION_ABORTED", "Lock wait aborted.", { committed: false }); };
  check(); progress("lock-wait"); check();
  const directory = path.resolve(lockPath), startedAt = Date.now();
  const owner: Participant = { version: 1, token: randomUUID(), pid: process.pid, ticket: null };
  const name = `${owner.pid}-${owner.token}.json`, file = path.join(directory, name), temporary = `${file}.tmp`;
  const timeoutMs = options.timeoutMs ?? 15_000, retryMs = options.retryMs ?? 50;
  const wait = async () => {
    check();
    if (Date.now() - startedAt >= timeoutMs) throw new HarnessError("LOCK_TIMEOUT", `Timed out waiting for lock: ${directory}`, { path: directory });
    await delay(retryMs); check();
  };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  if (!(await lstat(directory)).isDirectory()) corrupt(directory);
  await options.fault?.("directory-ready");
  const participants = async (): Promise<string[]> => {
    const result: string[] = [];
    for (const entry of await readdir(directory)) {
      check();
      const match = participantName.exec(entry);
      if (!match || !Number.isSafeInteger(Number(match[1]))) corrupt(path.join(directory, entry));
      if (!processIsAlive(Number(match[1]))) {
        // Only remove a dead invocation's unique file. No shared reclaim lock or successor path.
        await rm(path.join(directory, entry), { force: true });
      } else if (!match[3]) result.push(entry);
    }
    return result;
  };
  const publish = async () => {
    await writeFile(temporary, `${JSON.stringify(owner)}\n`, { flag: "wx", mode: 0o600 });
    if (owner.ticket !== null) await options.fault?.("ticket-staged");
    await rename(temporary, file);
  };
  try {
    await publish();
    await options.fault?.("choosing-published");
    let largest = 0n;
    for (const entry of await participants()) {
      const value = await readParticipant(directory, entry);
      if (value?.ticket && BigInt(value.ticket) > largest) largest = BigInt(value.ticket);
    }
    owner.ticket = (largest + 1n).toString();
    await publish();
    await options.fault?.("ticket-published");
    // Later arrivals see our published ticket and choose a larger one. A fixed scan suffices.
    for (const entry of await participants()) {
      if (entry === name) continue;
      while (true) {
        const other = await readParticipant(directory, entry);
        if (!other || !processIsAlive(other.pid)) break;
        if (other.ticket !== null && (BigInt(other.ticket) > BigInt(owner.ticket)
          || other.ticket === owner.ticket && other.token > owner.token)) break;
        await wait();
      }
    }
    check(); await options.fault?.("acquired"); check();
    const kind = path.basename(directory) === "external.lock" ? "external" : path.basename(directory) === ".store.lock" ? "home" : "resource";
    emit(`lock.${kind}.wait`, Date.now() - startedAt, "ms");
    return await measured(`lock.${kind}.hold`, action);
  } finally {
    await rm(file, { force: true });
    await rm(temporary, { force: true });
    await options.fault?.("released");
  }
}

export function homeLockPath(home: string): string {
  return path.join(path.resolve(home), "locks", "write.lock");
}
export function targetLockPath(destination: string): string {
  const digest = createHash("sha256").update(path.resolve(destination)).digest("hex");
  return path.join(tmpdir(), "harnessbrew-target-locks", `${digest}.lock`);
}
export function withHomeLock<T>(home: string, action: () => Promise<T>, options?: LockOptions): Promise<T> {
  return withFileLock(homeLockPath(home), action, options);
}
export function withTargetLock<T>(destination: string, action: () => Promise<T>, options?: LockOptions): Promise<T> {
  return withFileLock(targetLockPath(destination), action, options);
}
