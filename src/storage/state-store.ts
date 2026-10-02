import { randomUUID } from "node:crypto";
import path from "node:path";
import { withFileLock } from "../transactions/file-lock.js";
import { HarnessError } from "../domain/errors.js";
import { absolutePath, digest, hash, identifier } from "../domain/identity.js";
import { canonicalJson, format } from "../domain/validation.js";
import { nodeStorageIO, type FaultInjector, type StorageIO } from "../ports/io.js";
import { emptyHomeState, parseHomeState, type HomeState } from "../domain/home-state.js";

export interface ExclusiveStateAccess {
  read(): Promise<HomeState>;
  publish(expectedRevision: string, candidate: HomeState): Promise<HomeState>;
  restore(expectedRevision: string, previous: HomeState): Promise<void>;
}

/** Atomic metadata storage; the coordinator holds the same lock for its entire transaction. */
export class StateStore {
  private location: string;
  get home(): string { return this.location; }
  private readonly io: StorageIO;
  private readonly fault: FaultInjector;
  constructor(home: string, options: { io?: StorageIO; fault?: FaultInjector } = {}) {
    this.location = absolutePath(home);
    this.io = options.io ?? nodeStorageIO;
    this.fault = options.fault ?? (() => undefined);
  }
  private get current(): string { return path.join(this.home, "CURRENT"); }
  private get revisions(): string { return path.join(this.home, "revisions"); }
  private async regular(file: string, kind: "file" | "directory"): Promise<void> {
    if (await this.io.kind(file) !== kind) throw new HarnessError("STATE_CORRUPT", `Expected ${kind}: ${file}`);
  }
  private async homeDirectory(): Promise<void> {
    const homeKind = await this.io.kind(this.home);
    if (homeKind !== "missing" && homeKind !== "directory") {
      throw new HarnessError("STATE_CORRUPT", `Unsafe Home: ${this.home}`);
    }
    // Existing parent aliases (e.g. macOS /var) resolve to one lock identity.
    let ancestor = path.dirname(this.home);
    while (await this.io.kind(ancestor) === "missing") ancestor = path.dirname(ancestor);
    const resolved = await this.io.realpath(ancestor);
    this.location = path.join(resolved, path.relative(ancestor, this.home));
  }

  private async locked<T>(action: () => Promise<T>): Promise<T> {
    await this.homeDirectory();
    await this.io.mkdir(this.home);
    return withFileLock(path.join(this.home, ".store.lock"), action);
  }
  async initialize(seed?: HomeState): Promise<HomeState> {
    return this.locked(async () => {
      if (await this.io.kind(this.current) !== "missing") return this.read();
      const entries = (await this.io.list(this.home)).filter(name => name !== ".store.lock");
      if (entries.length) throw new HarnessError("UNSUPPORTED_FORMAT", "Home is not empty or contains an incomplete state; use a new Home.", { entries });
      await this.io.mkdir(this.revisions);
      const revision = randomUUID();
      return this.publish(seed ? { ...parseHomeState(seed), revision, install: { ...seed.install, revision } } : emptyHomeState(revision));
    });
  }
  async read(): Promise<HomeState> {
    await this.homeDirectory();
    if (await this.io.kind(this.current) === "missing") {
      throw new HarnessError("UNSUPPORTED_FORMAT", "Home has no supported CURRENT document; initialize a new empty Home.");
    }
    await this.regular(this.current, "file");
    const pointer = this.json(await this.io.read(this.current), "CURRENT");
    const item = format(pointer, "harnessbrew.current", ["revision", "digest"]);
    const revision = identifier(item.revision);
    const expectedDigest = digest(item.digest);
    await this.regular(this.revisions, "directory");
    const file = path.join(this.revisions, `${revision}.json`);
    await this.regular(file, "file");
    const content = await this.io.read(file);
    if (hash(content) !== expectedDigest) throw new HarnessError("STATE_CORRUPT", "State snapshot digest does not match CURRENT.", { revision });
    const state = parseHomeState(this.json(content, revision));
    if (state.revision !== revision) throw new HarnessError("STATE_CORRUPT", "State snapshot revision does not match CURRENT.");
    return state;
  }
  /** Compare-and-swap prevents lost updates, including across independently created store instances. */
  async commit(expectedRevision: string, candidate: HomeState): Promise<HomeState> {
    // Clone/validate before awaiting I/O so caller mutation cannot change an in-flight commit.
    const next = parseHomeState(candidate);
    return this.locked(async () => {
      if (await this.io.kind(path.join(this.home, "transaction.json")) !== "missing") throw new HarnessError("RECOVERY_REQUIRED", "A journal must be recovered before committing state.");
      const current = await this.read();
      if (current.revision !== expectedRevision || next.revision !== expectedRevision) {
        throw new HarnessError("PLAN_STALE", "State changed since this candidate was read.", { expectedRevision, actualRevision: current.revision });
      }
      if (canonicalJson(next) === canonicalJson(current)) return current;
      const revision = randomUUID();
      return this.publish({ ...next, revision, install: { ...next.install, revision } });
    });
  }
  /** Internal coordinator port. Its lease is valid only inside this callback; no nested store lock. */
  async withTransaction<T>(action: (access: ExclusiveStateAccess) => Promise<T>): Promise<T> {
    return this.locked(async () => {
      let active = true;
      const check = () => { if (!active) throw new HarnessError("INVALID_ARGUMENT", "Expired state transaction lease."); };
      try { return await action({
        read: async () => { check(); return this.read(); },
        publish: async (expectedRevision, candidate) => {
          check();
          const current = await this.read(), next = parseHomeState(candidate);
          if (current.revision !== expectedRevision || next.revision === expectedRevision) throw new HarnessError("PLAN_STALE", "Invalid transaction revision transition.");
          return this.publish(next);
        },
        restore: async (expectedRevision, expectedPrevious) => {
          check();
          const previousRevision = expectedPrevious.revision;
          const current = await this.read();
          if (current.revision !== expectedRevision) throw new HarnessError("RECOVERY_CONFLICT", "State changed outside this transaction.");
          const file = path.join(this.revisions, `${identifier(previousRevision)}.json`);
          await this.regular(file, "file");
          const content = await this.io.read(file);
          const previous = parseHomeState(this.json(content, previousRevision));
          if (previous.revision !== previousRevision || canonicalJson(previous) !== canonicalJson(expectedPrevious)) throw new HarnessError("RECOVERY_CONFLICT", "Previous revision differs from journal evidence.");
          const temporary = path.join(this.home, `.CURRENT-${randomUUID()}.tmp`);
          await this.io.writeExclusive(temporary, `${canonicalJson({ format: "harnessbrew.current", version: 1, revision: previousRevision, digest: hash(content) })}\n`);
          await this.io.rename(temporary, this.current);
          await this.io.syncDirectory(this.home);
        }
      }); } finally { active = false; }
    });
  }
  private json(content: string, document: string): unknown {
    try { return JSON.parse(content) as unknown; }
    catch (cause) { throw new HarnessError("STATE_CORRUPT", `Malformed JSON in ${document}.`, { document }, { cause }); }
  }
  private async publish(candidate: HomeState): Promise<HomeState> {
    const state = parseHomeState(candidate);
    await this.regular(this.revisions, "directory");
    const content = `${canonicalJson(state)}\n`;
    const file = path.join(this.revisions, `${state.revision}.json`);
    const temporary = path.join(this.home, `.CURRENT-${randomUUID()}.tmp`);
    await this.io.writeExclusive(file, content);
    await this.io.syncDirectory(this.revisions);
    await this.fault("revision-durable");
    let published = false;
    try {
      await this.io.writeExclusive(temporary, `${canonicalJson({ format: "harnessbrew.current", version: 1, revision: state.revision, digest: hash(content) })}\n`);
      await this.fault("before-publish");
      await this.io.rename(temporary, this.current);
      published = true;
      try { await this.io.syncDirectory(this.home); }
      catch (cause) {
        throw new HarnessError("RECOVERY_REQUIRED", "CURRENT was published but directory durability could not be confirmed. Re-read state before retrying.", { revision: state.revision }, { cause });
      }
    } finally {
      // An unpublished temporary pointer is safe to leave for inspection if cleanup also fails.
      // Never mask the original I/O error or turn an already published result into a cleanup failure.
      if (!published) await this.io.remove(temporary).catch(() => undefined);
    }
    return state;
  }
}
