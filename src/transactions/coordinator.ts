import { validateExecution } from "../execution/validate.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AdapterProvider, AssetReader } from "../domain/adapter.js";
import type { CatalogSnapshot } from "../domain/catalog.js";
import { CatalogIndex } from "../domain/catalog-index.js";
import type { HomeState } from "../domain/home-state.js";
import { HarnessError } from "../domain/errors.js";
import { absolutePath, contained, hash } from "../domain/identity.js";
import type { ChangePlan, ResourcePrecondition } from "../domain/plan.js";
import { canonicalJson } from "../domain/validation.js";
import { StateStore, type ExclusiveStateAccess } from "../storage/state-store.js";
import { assertPlanFresh } from "../planning/preconditions.js";
import { precondition } from "../planning/resources.js";
import { nodePlanningIO } from "../ports/planning.js";
import { stageContent, publishContent } from "../execution/content.js";
import { exists, image, removeDirectory, sameImage, syncDirectory, writeImage, type FileImage } from "../execution/files.js";
import { stateAfterExecution } from "../execution/state.js";
import { JournalStore, type Journal, type JournalStep } from "./journal.js";
import { withFileLock } from "./file-lock.js";

export type TransactionCheckpoint = "prepared" | "before-write" | "after-write" | "after-record" | "before-state" | "after-state" | "committed" | "before-rollback" | "before-cleanup";
export type TransactionFault = (point: TransactionCheckpoint, context: { transactionId: string; path?: string }) => void | Promise<void>;
export interface ExecutionInput {
  plan: ChangePlan; catalog: CatalogSnapshot; assets: AssetReader; adapters: AdapterProvider;
  bundleLock?: { path: string; before: ResourcePrecondition };
}
export interface ExecutionResult { transactionId?: string; committedRevision: string; changes: ChangePlan["assetChanges"]; retained: ChangePlan["desiredState"]["retained"]; diagnostics: string[] }
export interface TransactionSession {
  read(): Promise<HomeState>;
  apply(input: ExecutionInput): Promise<ExecutionResult>;
}
const sessions = new AsyncLocalStorage<{ home: string; session: TransactionSession }>();

export class TransactionCoordinator {
  private readonly store: StateStore;
  private readonly fault: TransactionFault;
  private readonly lockRoot: string;
  constructor(home: string, options: { lockRoot?: string; fault?: TransactionFault; store?: StateStore } = {}) {
    this.store = options.store ?? new StateStore(home);
    this.lockRoot = options.lockRoot ?? path.join(tmpdir(), `harnessbrew-transactions-${process.getuid?.() ?? "user"}`);
    this.fault = options.fault ?? (() => undefined);
  }
  async read(): Promise<HomeState> {
    const nested = sessions.getStore();
    if (nested) {
      if (nested.home === await realpath(this.store.home)) return nested.session.read();
      throw new HarnessError("INVALID_ARGUMENT", "Nested reads across Homes are not supported.");
    }
    return this.store.withTransaction(async access => {
      if (await new JournalStore(this.store.home).load()) throw new HarnessError("RECOVERY_REQUIRED", "Read is blocked by an unfinished transaction.");
      return access.read();
    });
  }
  /** Helpers inside one session reuse locks. The callback builds the complete plan before apply. */
  async withSession<T>(action: (session: TransactionSession) => Promise<T>): Promise<T> {
    const nested = sessions.getStore();
    if (nested && nested.home === await realpath(this.store.home)) return action(nested.session);
    if (nested) throw new HarnessError("INVALID_ARGUMENT", "Nested transactions across Homes are not supported.");
    return this.store.withTransaction(async access => {
      await mkdir(this.lockRoot, { recursive: true, mode: 0o700 });
      if (!(await lstat(this.lockRoot)).isDirectory()) throw new HarnessError("RECOVERY_REQUIRED", "Unsafe external lock root.");
      return withFileLock(path.join(this.lockRoot, "external.lock"), async () => {
        const journal = new JournalStore(this.store.home);
        await this.recoverLocked(access, journal);
        let active = true, applying = false;
        const check = () => { if (!active) throw new HarnessError("INVALID_ARGUMENT", "Expired transaction session."); };
        const session: TransactionSession = {
          read: async () => { check(); if (await journal.load()) throw new HarnessError("RECOVERY_REQUIRED", "Transaction is not at a committed boundary."); return access.read(); },
          apply: async input => { check(); if (applying) throw new HarnessError("INVALID_ARGUMENT", "Cannot recursively apply a plan."); applying = true;
            try { return await this.executeLocked(access, journal, input); } finally { applying = false; }
          }
        };
        try { return await sessions.run({ home: this.store.home, session }, () => action(session)); }
        finally { active = false; }
      });
    });
  }
  async execute(build: (state: HomeState) => Promise<ExecutionInput>): Promise<ExecutionResult> {
    return this.withSession(async session => session.apply(await build(await session.read())));
  }
  async apply(input: ExecutionInput): Promise<ExecutionResult> {
    const copied = { ...input, plan: structuredClone(input.plan), catalog: structuredClone(input.catalog), ...(input.bundleLock ? { bundleLock: structuredClone(input.bundleLock) } : {}) };
    return this.withSession(session => session.apply(copied));
  }
  async recover(): Promise<void> { await this.withSession(async () => undefined); }
  private async targetsLocked<T>(destinations: string[], action: () => Promise<T>): Promise<T> {
    const names = [...new Set(destinations)].sort();
    const lock = (i: number): Promise<T> => i === names.length ? action() : withFileLock(path.join(this.lockRoot, `${hash(names[i]!).slice(7)}.lock`), () => lock(i + 1));
    return lock(0);
  }
  private async parentUnchanged(step: JournalStep): Promise<void> {
    const actual = await nodePlanningIO.identify(step.path);
    if (canonicalJson(actual) !== canonicalJson(step.parent)) throw new HarnessError("RECOVERY_CONFLICT", "Resource parent changed.", { path: step.path });
  }
  private async recoverLocked(access: ExclusiveStateAccess, store: JournalStore): Promise<void> {
    const journal = await store.load(); if (!journal) return;
    await this.targetsLocked(journal.steps.map(step => step.path), async () => {
      if (journal.status === "committed") {
        if (!journal.nextState || canonicalJson(await access.read()) !== canonicalJson(journal.nextState)) throw new HarnessError("RECOVERY_CONFLICT", "Committed journal and state disagree.");
        await this.cleanup(store, journal); return;
      }
      try { await this.rollback(access, store, journal); }
      catch (cause) { journal.status = "recovery-required"; await store.save(journal).catch(() => undefined); throw new HarnessError("RECOVERY_REQUIRED", "Recovery could not safely restore the transaction.", { transactionId: journal.id }, { cause }); }
    });
  }
  private async rollback(access: ExclusiveStateAccess, store: JournalStore, journal: Journal): Promise<void> {
    await this.fault("before-rollback", { transactionId: journal.id });
    journal.status = "rolling-back"; await store.save(journal);
    const state = await access.read();
    if ((state.revision === journal.beforeState.revision && canonicalJson(state) !== canonicalJson(journal.beforeState)) || (state.revision === journal.nextRevision && (!journal.nextState || canonicalJson(state) !== canonicalJson(journal.nextState)))) throw new HarnessError("RECOVERY_CONFLICT", "State content differs from journal evidence.");
    if (state.revision !== journal.beforeState.revision && state.revision !== journal.nextRevision) throw new HarnessError("RECOVERY_CONFLICT", "State was replaced outside the transaction.");
    for (const step of [...journal.steps].reverse()) {
      if (step.phase === "reverted") continue;
      await this.parentUnchanged(step);
      const actual = await image(step.path, step.kind === "content");
      if (!sameImage(actual, step.before)) {
        if (!step.after || !sameImage(actual, step.after)) throw new HarnessError("RECOVERY_CONFLICT", "A write is unrecorded or was changed externally.", { path: step.path });
        step.phase = "reverting"; await store.save(journal);
        if (step.before.kind === "missing" && step.after.kind === "directory") await removeDirectory(step.path);
        else if (step.before.kind === "missing" && step.after.kind === "content") { await rm(step.path, { recursive: true }); await syncDirectory(path.dirname(step.path)); }
        else await writeImage(step.path, step.before, step.temporary);
      }
      // A transaction-specific temporary is never used as proof that a target write is owned.
      if (await exists(step.temporary)) throw new HarnessError("RECOVERY_CONFLICT", "Unrecorded temporary resource requires inspection.", { path: step.temporary });
      step.phase = "reverted"; await store.save(journal);
    }
    if (state.revision === journal.nextRevision) await access.restore(journal.nextRevision, journal.beforeState);
    journal.status = "rolled-back"; await store.save(journal);
    await this.cleanup(store, journal);
  }
  private async cleanup(store: JournalStore, journal: Journal): Promise<void> {
    await this.fault("before-cleanup", { transactionId: journal.id });
    const staging = path.join(this.store.home, `.transaction-${journal.id}`);
    if (await exists(staging)) {
      if (!(await lstat(staging)).isDirectory()) throw new HarnessError("RECOVERY_CONFLICT", "Unsafe transaction cache.");
      await rm(staging, { recursive: true }); await syncDirectory(this.store.home);
    }
    await store.clear();
  }
  private async executeLocked(access: ExclusiveStateAccess, store: JournalStore, input: ExecutionInput): Promise<ExecutionResult> {
    if (await store.load()) throw new HarnessError("RECOVERY_REQUIRED", "Recover the previous transaction first.");
    const plan = structuredClone(input.plan), catalog = new CatalogIndex(input.catalog);
    const before = await access.read();
    await assertPlanFresh(plan, { revision: before.revision, home: this.store.home, io: nodePlanningIO, adapters: input.adapters });
    await validateExecution(plan, before, catalog, input.adapters, this.store.home);
    if (Boolean(plan.desiredState.bundleLock) !== Boolean(input.bundleLock)) throw new HarnessError("INVALID_PLAN", "Bundle plans require a lockfile destination and its preview precondition.");
    const destinations = plan.fileUpdates.map(update => update.path);
    let lockPath: string | undefined;
    if (input.bundleLock) {
      const requested = absolutePath(input.bundleLock.path);
      if (requested !== input.bundleLock.before.path || canonicalJson(precondition(await nodePlanningIO.inspect(requested))) !== canonicalJson(input.bundleLock.before)) throw new HarnessError("PLAN_STALE", "Bundle lockfile changed after preview.");
      lockPath = (await nodePlanningIO.identify(requested)).physicalPath;
      if (contained(this.store.home, lockPath) || plan.preconditions.some(p => p.identity.physicalPath === lockPath) || destinations.some(p => contained(p, lockPath!) || contained(lockPath!, p))) throw new HarnessError("OWNERSHIP_CONFLICT", "Bundle lockfile overlaps another transaction resource.");
      destinations.push(lockPath);
    }
    return this.targetsLocked(destinations, async () => {
      await assertPlanFresh(plan, { revision: before.revision, home: this.store.home, io: nodePlanningIO, adapters: input.adapters });
      const journal: Journal = { format: "harnessbrew.journal", version: 1, id: randomUUID(), home: this.store.home, status: "prepared", beforeState: before, nextRevision: randomUUID(), steps: [] };
      const directories: string[] = [];
      const checkpoint = (point: TransactionCheckpoint, destination?: string) => this.fault(point, { transactionId: journal.id, ...(destination ? { path: destination } : {}) });
      const step = async (destination: string, kind: JournalStep["kind"], intended: FileImage, perform?: () => Promise<void>) => {
        const previous = await image(destination, kind === "content");
        const entry: JournalStep = { path: destination, kind, temporary: path.join(path.dirname(destination), `.harnessbrew-${journal.id}-${journal.steps.length}.tmp`), before: previous, intended, parent: await nodePlanningIO.identify(destination), phase: "pending" };
        journal.status = "applying"; journal.steps.push(entry); await store.save(journal);
        await checkpoint("before-write", destination); await this.parentUnchanged(entry);
        if (!sameImage(await image(destination, kind === "content"), previous)) throw new HarnessError("TARGET_MODIFIED", "Resource changed before execution.");
        if (perform) await perform(); else await writeImage(destination, intended, entry.temporary);
        await checkpoint("after-write", destination);
        const actual = await image(destination, kind === "content");
        if (intended.kind === "directory" ? actual.kind !== "directory" : intended.kind === "content" ? actual.kind !== "content" || actual.digest !== intended.digest : !sameImage(actual, intended)) throw new HarnessError("TARGET_MODIFIED", "Write verification failed.");
        entry.after = actual; entry.phase = "done"; await store.save(journal); await checkpoint("after-record", destination);
      };
      const ensureParents = async (destination: string) => {
        const missing: string[] = []; let current = path.dirname(destination);
        while (!await exists(current)) { missing.unshift(current); current = path.dirname(current); }
        if (!(await lstat(current)).isDirectory()) throw new HarnessError("TARGET_MODIFIED", "Target parent is not a directory.");
        for (const directory of missing) { await step(directory, "directory", { kind: "directory", device: "", inode: "", mode: 0o755 }); directories.push(directory); }
      };
      const checkExpected = async (expected: ResourcePrecondition) => {
        const actual = precondition(await nodePlanningIO.inspect(expected.path));
        const anchor = await nodePlanningIO.identify(path.join(expected.identity.ancestor.path, ".harnessbrew-parent-check"));
        if (canonicalJson(anchor.ancestor) !== canonicalJson(expected.identity.ancestor)
          || actual.identity.physicalPath !== expected.identity.physicalPath
          || canonicalJson(actual.fingerprint) !== canonicalJson(expected.fingerprint) || actual.mode !== expected.mode
          || (canonicalJson(actual.identity.ancestor) !== canonicalJson(expected.identity.ancestor) && !directories.includes(actual.identity.ancestor.path))) {
          throw new HarnessError("PLAN_STALE", "Target or parent changed during execution.", { path: expected.path });
        }
      };
      let committed = false;
      try {
        await store.save(journal); await checkpoint("prepared");
        const contentRoot = path.join(this.store.home, "content");
        if (await exists(contentRoot) && !(await lstat(contentRoot)).isDirectory()) throw new HarnessError("CONTENT_MODIFIED", "Content root is not a directory.");
        const staging = path.join(this.store.home, `.transaction-${journal.id}`);
        for (const asset of plan.desiredState.assets) {
          const destination = path.join(this.store.home, "content", asset.contentDigest.slice(7));
          const existing = await image(destination, true);
          if (existing.kind !== "missing") {
            if (existing.kind !== "content" || existing.digest !== asset.contentDigest) throw new HarnessError("CONTENT_MODIFIED", "Installed content was changed.", { asset: asset.coordinate });
            continue;
          }
          if (before.install.assets.some(previous => previous.contentDigest === asset.contentDigest)) throw new HarnessError("CONTENT_MODIFIED", "Previously installed content is missing; explicit repair is required.");
          const source = catalog.pinned(asset);
          if (!source || source.snapshotId !== asset.snapshotId) throw new HarnessError("SOURCE_NOT_FOUND", "Missing pinned content for execution.");
          await mkdir(staging, { recursive: true, mode: 0o700 });
          const staged = path.join(staging, asset.contentDigest.slice(7));
          await stageContent(staged, source, input.assets);
          await ensureParents(destination);
          await step(destination, "content", { kind: "content", digest: asset.contentDigest, device: "", inode: "" }, () => publishContent(staged, destination));
        }
        // All content is ready before any target is activated.
        for (const update of plan.fileUpdates) {
          await checkExpected(update.before);
          await ensureParents(update.path);
          const next: FileImage = update.after.kind === "file" ? { kind: "file", bytes: Buffer.from(update.after.content, "utf8").toString("base64"), mode: update.after.mode } : update.after;
          await step(update.path, "target", next);
        }
        if (lockPath && input.bundleLock) {
          await checkExpected(input.bundleLock.before);
          const next: FileImage = { kind: "file", bytes: Buffer.from(`${canonicalJson(plan.desiredState.bundleLock)}\n`).toString("base64"), mode: input.bundleLock.before.mode ?? 0o644 };
          if (!sameImage(await image(lockPath), next)) { await ensureParents(lockPath); await step(lockPath, "lockfile", next); }
        }
        let candidate = await stateAfterExecution(before, plan, journal.nextRevision, directories);
        const normalized = { ...candidate, revision: before.revision, install: { ...candidate.install, revision: before.revision } };
        if (!journal.steps.length && canonicalJson(normalized) === canonicalJson(before)) {
          await this.cleanup(store, journal);
          return { committedRevision: before.revision, changes: [], retained: plan.desiredState.retained, diagnostics: [] };
        }
        await checkpoint("before-state");
        for (const expected of [...plan.preconditions, ...(input.bundleLock ? [input.bundleLock.before] : [])]) {
          const actual = await nodePlanningIO.identify(expected.path);
          const anchor = await nodePlanningIO.identify(path.join(expected.identity.ancestor.path, ".harnessbrew-parent-check"));
          if (actual.physicalPath !== expected.identity.physicalPath || canonicalJson(anchor.ancestor) !== canonicalJson(expected.identity.ancestor)) throw new HarnessError("PLAN_STALE", "A planned parent path changed during execution.");
        }
        for (const asset of plan.desiredState.assets) {
          const actual = await image(path.join(this.store.home, "content", asset.contentDigest.slice(7)), true);
          if (actual.kind !== "content" || actual.digest !== asset.contentDigest) throw new HarnessError("CONTENT_MODIFIED", "Content changed before state publication.");
        }
        for (const signature of plan.adapterSignatures) {
          const adapter = input.adapters.get(signature.name);
          if (adapter.signature !== signature.signature || adapter.adapter.version !== signature.version) throw new HarnessError("ADAPTER_CHANGED", "Adapter changed during execution.");
        }
        candidate = await stateAfterExecution(before, plan, journal.nextRevision, directories);
        journal.nextState = candidate; await store.save(journal);
        await access.publish(before.revision, candidate); await checkpoint("after-state");
        journal.status = "committed"; await store.save(journal); committed = true;
        const diagnostics: string[] = [];
        try { await checkpoint("committed"); await this.cleanup(store, journal); }
        catch { diagnostics.push("Transaction committed; maintenance cleanup is pending."); }
        return { transactionId: journal.id, committedRevision: candidate.revision, changes: plan.assetChanges, retained: plan.desiredState.retained, diagnostics };
      } catch (cause) {
        let persisted: Journal | undefined;
        try { persisted = await store.load(); }
        catch (journalError) { throw new HarnessError("RECOVERY_REQUIRED", "Operation failed and journal integrity cannot be verified.", { transactionId: journal.id }, { cause: new AggregateError([cause, journalError]) }); }
        if (committed || persisted?.status === "committed") throw new HarnessError("RECOVERY_REQUIRED", "Commit durability could not be confirmed; recover before retrying.", { transactionId: journal.id }, { cause });
        try { await this.rollback(access, store, journal); }
        catch (recoveryError) {
          journal.status = "recovery-required"; await store.save(journal).catch(() => undefined);
          throw new HarnessError("RECOVERY_REQUIRED", "Operation and recovery failed; preserve the journal.", { transactionId: journal.id }, { cause: new AggregateError([cause, recoveryError], "Original failure and recovery failure") });
        }
        throw cause;
      }
    });
  }
}
