import { lstat } from "node:fs/promises";
import path from "node:path";
import { HarnessError } from "../domain/errors.js";
import { absolutePath, hash, identifier } from "../domain/identity.js";
import { parseHomeState } from "../domain/home-state.js";
import { array, canonicalJson, record, text } from "../domain/validation.js";
import type { PlanningIO, PathIdentity } from "../domain/plan.js";
import { cacheDirectory } from "./cache.js";
import type { PlanDocumentIO } from "./dependencies.js";
import type { Saved } from "./saved.js";
import type { ChangeRequest } from "./types.js";
import { parseRequest } from "./requests.js";
import * as schema from "./prepared-schema.js";

export function parsePrepared(value: unknown): Saved {
  if (value && typeof value === "object" && (value as { format?: unknown }).format === "harnessbrew.saved-plan" && (value as { version?: unknown }).version === 1) throw new HarnessError("PLAN_STALE", "Version 1 preview must be generated again.");
  try {
    const v = record(value, "prepared change", ["format", "version", "id", "home", "homeIdentity", "resources", "preparedContent", "request", "baseRevision", "candidate", "plan", "catalog", "bundleLock", "inputs", "diagnostics", "restorations", "contentChecks", "contentChanges"]);
    if (v.format !== "harnessbrew.saved-plan" || v.version !== 2 || typeof v.id !== "string" || !/^[a-f0-9-]{36}$/u.test(v.id)) throw new Error("Unsupported prepared identity");
    absolutePath(v.home); identifier(v.baseRevision); schema.pathIdentity(v.homeIdentity);
    array(v.resources, "resources", absolutePath); array(v.diagnostics, "diagnostics", x => text(x, "diagnostic"));
    array(v.inputs, "inputs", schema.resourcePrecondition); parseRequest(v.request as ChangeRequest);
    if ((v.candidate !== undefined) === (v.plan !== undefined)) throw new Error("Choose metadata or installation plan");
    if (v.candidate !== undefined) { const state = parseHomeState(v.candidate); if (state.revision !== v.baseRevision || v.catalog !== undefined) throw new Error("Invalid candidate revision"); }
    if (v.plan !== undefined) { schema.planData(v.plan); schema.catalogData(v.catalog); if ((v.plan as { baseRevision: string }).baseRevision !== v.baseRevision) throw new Error("Invalid plan revision"); }
    if (v.bundleLock !== undefined) schema.bundleLock(v.bundleLock);
    if (v.restorations !== undefined) schema.restorations(v.restorations);
    if (v.preparedContent !== undefined) schema.stagedContents(v.preparedContent);
    if (v.contentChecks !== undefined) schema.contentChecks(v.contentChecks);
    if (v.contentChanges !== undefined) schema.contentChanges(v.contentChanges);
    canonicalJson(v);
    return structuredClone(v) as unknown as Saved;
  } catch (cause) { throw new HarnessError("INVALID_PLAN", "Malformed prepared change.", {}, { cause }); }
}

export function sameHomeIdentity(left: PathIdentity, right: PathIdentity): boolean {
  const physical = (value: PathIdentity) => ({ ...value, ancestor: { ...value.ancestor, path: value.ancestor.realPath } });
  return canonicalJson(physical(left)) === canonicalJson(physical(right));
}

export class PlanStore {
  constructor(private readonly cache: string, private readonly documents: PlanDocumentIO, private readonly planning: PlanningIO) {}
  async save(input: Saved): Promise<void> {
    const saved = parsePrepared(input);
    await cacheDirectory(this.cache, "plans");
    await this.documents.write(path.join(this.cache, "plans", `${saved.id}.json`), { digest: hash(canonicalJson(saved)), saved });
  }
  async load(id: string, home: string): Promise<Saved> {
    if (!/^[a-f0-9-]{36}$/u.test(id)) throw new HarnessError("PLAN_NOT_FOUND", "Unknown plan ID.");
    try {
      const file = path.join(this.cache, "plans", `${id}.json`);
      for (const dir of [this.cache, path.dirname(file)]) if (!(await lstat(dir)).isDirectory()) throw new HarnessError("INVALID_PLAN", "Unsafe saved plan directory.");
      if (!(await lstat(file)).isFile()) throw new HarnessError("INVALID_PLAN", "Saved plan must be a regular file.");
      const envelope = record(JSON.parse(await this.documents.read(file)), "plan envelope", ["digest", "saved"]);
      if (envelope.digest !== hash(canonicalJson(envelope.saved))) throw new HarnessError("INVALID_PLAN", "Saved plan integrity failed.");
      const saved = parsePrepared(envelope.saved);
      if (saved.id !== id) throw new HarnessError("INVALID_PLAN", "Saved plan ID mismatch.");
      const actual = await this.planning.identify(path.join(home, "CURRENT"));
      if (!sameHomeIdentity(actual, saved.homeIdentity)) throw new HarnessError("PLAN_STALE", "Physical Home changed after preparation.");
      return saved;
    } catch (cause) {
      if (cause instanceof HarnessError) throw cause;
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") throw new HarnessError("PLAN_NOT_FOUND", "Saved plan is unavailable.", {}, { cause });
      throw new HarnessError("INVALID_PLAN", "Cannot read saved plan.", {}, { cause });
    }
  }
}
