import { lstat, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { HomeState } from "../domain/home-state.js";
import { parseHomeState } from "../domain/home-state.js";
import type { PathIdentity } from "../domain/plan.js";
import { absolutePath, hash, identifier } from "../domain/identity.js";
import { HarnessError } from "../domain/errors.js";
import { canonicalJson } from "../domain/validation.js";
import { atomicDocument, exists, syncDirectory, type FileImage } from "../execution/files.js";

export interface JournalStep {
  path: string; temporary: string; kind: "target" | "directory" | "content" | "lockfile";
  before: FileImage; intended: FileImage; parent: PathIdentity;
  phase: "pending" | "done" | "reverting" | "reverted"; after?: FileImage;
}
export interface Journal {
  format: "harnessbrew.journal"; version: 1; id: string; home: string;
  status: "prepared" | "applying" | "committed" | "rolling-back" | "rolled-back" | "recovery-required";
  beforeState: HomeState; nextRevision: string; nextState?: HomeState; steps: JournalStep[];
}
export class JournalStore {
  readonly file: string;
  constructor(readonly home: string) { this.file = path.join(home, "transaction.json"); }
  async load(): Promise<Journal | undefined> {
    if (!await exists(this.file)) return undefined;
    try {
      if (!(await lstat(this.file)).isFile()) throw new Error("Journal is not a regular file");
      const envelope = JSON.parse(await readFile(this.file, "utf8")) as { digest: string; journal: Journal };
      const journal = envelope.journal;
      if (envelope.digest !== hash(canonicalJson(journal)) || journal.format !== "harnessbrew.journal" || journal.version !== 1 || journal.home !== this.home
        || !["prepared", "applying", "committed", "rolling-back", "rolled-back", "recovery-required"].includes(journal.status)) throw new Error("Journal identity or digest mismatch");
      identifier(journal.id); identifier(journal.nextRevision); parseHomeState(journal.beforeState);
      if (journal.nextState) { parseHomeState(journal.nextState); if (journal.nextState.revision !== journal.nextRevision) throw new Error("Next revision mismatch"); }
      if (!Array.isArray(journal.steps)) throw new Error("Invalid journal steps");
      for (const step of journal.steps) {
        if (absolutePath(step.path) !== step.path || step.path === path.parse(step.path).root || path.dirname(step.temporary) !== path.dirname(step.path)
          || !path.basename(step.temporary).startsWith(`.harnessbrew-${journal.id}-`) || !["target", "directory", "content", "lockfile"].includes(step.kind)
          || !["pending", "done", "reverting", "reverted"].includes(step.phase)) throw new Error("Invalid journal step");
        if (step.kind === "content" && (path.dirname(step.path) !== path.join(this.home, "content") || !/^[a-f0-9]{64}$/u.test(path.basename(step.path)))) throw new Error("Invalid content path");
        if (!step.before || !step.intended || !step.parent || (step.phase === "done" && !step.after)) throw new Error("Incomplete journal image");
      }
      return journal;
    } catch (cause) { throw new HarnessError("RECOVERY_REQUIRED", "Journal is damaged; preserve it for explicit inspection.", { path: this.file }, { cause }); }
  }
  async save(journal: Journal): Promise<void> {
    await atomicDocument(this.file, { digest: hash(canonicalJson(journal)), journal });
  }
  async clear(): Promise<void> { await rm(this.file, { force: true }); await syncDirectory(this.home); }
}
