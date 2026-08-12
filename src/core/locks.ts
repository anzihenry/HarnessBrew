import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { HarnessBrewError } from "./errors.js";

export interface LockOptions {
  timeoutMs?: number;
  retryMs?: number;
}

interface LockOwner {
  token: string;
  pid: number;
  acquiredAt: string;
}

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function reclaimAbandonedLock(lockPath: string): Promise<boolean> {
  const reclaimPath = `${lockPath}.reclaim`;
  try {
    await mkdir(reclaimPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
  try {
    const owner = await readFile(path.join(lockPath, "owner.json"), "utf8")
      .then((content) => JSON.parse(content) as LockOwner)
      .catch(() => undefined);
    if (owner !== undefined && Number.isInteger(owner.pid) && owner.pid > 0 && !processIsAlive(owner.pid)) {
      await rm(lockPath, { recursive: true, force: true });
      return true;
    }
    return false;
  } finally {
    await rm(reclaimPath, { recursive: true, force: true });
  }
}

export async function withFileLock<T>(
  lockPath: string,
  action: () => Promise<T>,
  options: LockOptions = {}
): Promise<T> {
  const resolvedLock = path.resolve(lockPath);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const retryMs = options.retryMs ?? 50;
  const startedAt = Date.now();
  const owner: LockOwner = { token: randomUUID(), pid: process.pid, acquiredAt: new Date().toISOString() };
  await mkdir(path.dirname(resolvedLock), { recursive: true });
  while (true) {
    try {
      await mkdir(resolvedLock);
      await writeFile(path.join(resolvedLock, "owner.json"), `${JSON.stringify(owner)}\n`, { flag: "wx" });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        await rm(resolvedLock, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
      if (await reclaimAbandonedLock(resolvedLock)) continue;
      if (Date.now() - startedAt >= timeoutMs) {
        throw new HarnessBrewError(`Timed out waiting for lock: ${resolvedLock}`);
      }
      await delay(retryMs);
    }
  }
  try {
    return await action();
  } finally {
    const current = await readFile(path.join(resolvedLock, "owner.json"), "utf8")
      .then((content) => JSON.parse(content) as LockOwner)
      .catch(() => undefined);
    if (current?.token === owner.token) await rm(resolvedLock, { recursive: true, force: true });
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
