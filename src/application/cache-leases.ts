import { withoutCancellation } from "../observability/operation.js";
import { emit } from "../observability/measure.js";
import { randomUUID } from "node:crypto";
import { lstat, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { absolutePath, hash } from "../domain/identity.js";
import { canonicalJson, record, array } from "../domain/validation.js";
import { HarnessError } from "../domain/errors.js";
import { withFileLock } from "../transactions/file-lock.js";
import { atomicDocument, exists } from "../execution/files.js";
import { cacheDirectory } from "./cache.js";

export interface CacheReference { id: string; resources: string[] }
export interface CacheProtection { activeLease: boolean; resources: string[]; references: CacheReference[] }
const uuid = /^[a-f0-9-]{36}$/u;
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (cause) { return (cause as NodeJS.ErrnoException).code !== "ESRCH"; }
}
/** Cache-wide active leases favor correctness over GC concurrency. No Home lock is taken here. */
export class CacheLeases {
  constructor(readonly root: string) { absolutePath(root); }
  private async guarded<T>(action: () => Promise<T>): Promise<T> {
    await cacheDirectory(this.root, "leases");
    return withFileLock(path.join(this.root, ".leases.guard"), action);
  }
  async withLease<T>(action: () => Promise<T>): Promise<T> {
    const token = randomUUID(), file = path.join(this.root, "leases", `${token}.json`);
    await this.guarded(async () => {
      if (await exists(path.join(this.root, "maintenance", "transaction.json"))) throw new HarnessError("RECOVERY_REQUIRED", "Recover pending cache maintenance before acquiring a lease.", { action: "recover-maintenance" });
      await atomicDocument(file, { format: "harnessbrew.cache-lease", version: 1, token, pid: process.pid });
    });
    try { return await action(); }
    finally { await withoutCancellation(() => this.guarded(async () => { await rm(file, { force: true }); })).catch(() => emit("cache.lease.release-failed", 1, "count")); }
  }
  /** Publish references before releasing the producer lease, even if the plan write later fails. */
  async pin(id: string, resources: readonly string[]): Promise<void> {
    if (!uuid.test(id)) throw new HarnessError("INVALID_PLAN", "Invalid plan reference identity.");
    const references = [...new Set(resources.map(absolutePath))].sort();
    await this.guarded(async () => {
      const dir = await cacheDirectory(this.root, "references");
      const value = { format: "harnessbrew.cache-reference", version: 1, id, resources: references };
      await atomicDocument(path.join(dir, `${id}.json`), { value, digest: hash(canonicalJson(value)) });
    });
  }
  private async references(): Promise<CacheReference[]> {
    const dir = await cacheDirectory(this.root, "references"), references: CacheReference[] = [];
    for (const name of await readdir(dir)) {
      // Unknown and interrupted reference writes cannot authorize deletion.
      if (!name.endsWith(".json") || !uuid.test(name.slice(0, -5))) throw new HarnessError("LOCK_CORRUPT", "Inspect unknown cache reference before maintenance.");
      const file = path.join(dir, name);
      if (!(await lstat(file)).isFile()) throw new HarnessError("LOCK_CORRUPT", "Unsafe cache reference.");
      const envelope = record(JSON.parse(await readFile(file, "utf8")), "cache reference envelope", ["value", "digest"]);
      const value = record(envelope.value, "cache reference", ["format", "version", "id", "resources"]);
      if (value.format !== "harnessbrew.cache-reference" || value.version !== 1 || `${value.id}.json` !== name || envelope.digest !== hash(canonicalJson(value))) throw new HarnessError("LOCK_CORRUPT", "Invalid cache reference.");
      references.push({ id: value.id as string, resources: array(value.resources, "cache references", absolutePath) });
    }
    return references.sort((a, b) => a.id.localeCompare(b.id));
  }
  /** Read protection without removing stale leases or persistent references. */
  async inspect(): Promise<CacheProtection> {
    return this.guarded(async () => { const references = await this.references(); return { activeLease: await this.activeLeases(false), resources: [...new Set(references.flatMap(r => r.resources))].sort(), references }; });
  }
  private async activeLeases(reap: boolean): Promise<boolean> {
    const dir = path.join(this.root, "leases");
      for (const name of await readdir(dir)) {
        if (!name.endsWith(".json") || !uuid.test(name.slice(0, -5))) throw new HarnessError("LOCK_CORRUPT", "Inspect interrupted cache lease before maintenance.");
        const file = path.join(dir, name);
        if (!(await lstat(file)).isFile()) throw new HarnessError("LOCK_CORRUPT", "Unsafe cache lease.");
        const value = record(JSON.parse(await readFile(file, "utf8")), "cache lease", ["format", "version", "token", "pid"]);
        if (value.format !== "harnessbrew.cache-lease" || value.version !== 1 || `${value.token}.json` !== name || !Number.isSafeInteger(value.pid) || (value.pid as number) < 1) throw new HarnessError("LOCK_CORRUPT", "Invalid cache lease.");
        if (alive(value.pid as number)) return true;
        if (reap) await rm(file); // Reap only proven dead processes; PID reuse conservatively protects.
      }
    return false;
  }
  /** C-batch GC must mark/delete under this guard and exclude every protected root/descendant. */
  async tryMaintenance<T>(action: (protectedResources: readonly string[], references: readonly CacheReference[]) => Promise<T>): Promise<{ ran: false } | { ran: true; value: T }> {
    return this.guarded(async () => {
      if (await this.activeLeases(true)) return { ran: false };
      const references = await this.references();
      return { ran: true, value: await action([...new Set(references.flatMap(r => r.resources))].sort(), references) };
    });
  }
}

/** Historical snapshots can live in a previous lexical Home's cache. Protect those roots too. */
export function relatedCacheRoots(resources: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const resource of resources) {
    let current = path.dirname(absolutePath(resource));
    while (current !== path.dirname(current)) {
      if (/^\.harnessbrew-cache-[a-f0-9]+$/u.test(path.basename(current))) { roots.add(current); break; }
      current = path.dirname(current);
    }
  }
  return [...roots].sort();
}
export async function withRelatedCacheLeases<T>(resources: readonly string[], action: () => Promise<T>): Promise<T> {
  const roots = relatedCacheRoots(resources);
  const next = (i: number): Promise<T> => i === roots.length ? action() : new CacheLeases(roots[i]!).withLease(() => next(i + 1));
  return next(0);
}
