import { lstat, readFile, readdir, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { HarnessError } from "../domain/errors.js";
import { hash } from "../domain/identity.js";
import { canonicalJson, record } from "../domain/validation.js";
import { atomicDocument, exists, syncDirectory } from "../execution/files.js";
import { JournalStore } from "../transactions/journal.js";
import { StateStore } from "../storage/state-store.js";
import { CacheLeases } from "./cache-leases.js";
import { cacheDirectory } from "./cache.js";
import { inspectTree, maintenanceSnapshot, type MaintenancePreview, type MaintenanceTreeEntry } from "./maintenance.js";

export interface MaintenanceResult { status: "complete"; planId: string; deleted: string[]; retiredReferences: string[]; recovered: boolean }
export type MaintenanceFault = (point: "journal-durable" | "quarantined" | "delete-recorded" | "entry-deleted", file?: string) => void | Promise<void>;
interface Entry { source: string; quarantine: string; digest: string; tree: MaintenanceTreeEntry[]; phase: "pending" | "quarantined" | "deleting" | "done"; reference: boolean }
interface MaintenanceJournal { format: "harnessbrew.maintenance-journal"; version: 1; id: string; home: string; cache: string; rootDevice: string; rootInode: string; entries: Entry[] }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const conflict = (message: string): never => { throw new HarnessError("RECOVERY_CONFLICT", message); };
const stale = (message: string): never => { throw new HarnessError("PLAN_STALE", message); };
const journalFile = (cache: string) => path.join(cache, "maintenance", "transaction.json");
async function save(journal: MaintenanceJournal) { await atomicDocument(journalFile(journal.cache), { digest: hash(canonicalJson(journal)), journal }); }
function allowedSource(cache: string, source: string, reference: boolean): boolean {
  const relative = path.relative(cache, source).split(path.sep);
  return relative.length === 2 && (reference ? relative[0] === "references" && uuid.test(relative[1]!.replace(/\.json$/u, "")) && relative[1]!.endsWith(".json")
    : relative[0] === "plans" ? uuid.test(relative[1]!.replace(/\.json$/u, "")) && relative[1]!.endsWith(".json")
    : ["prepared", "restores"].includes(relative[0]!) && uuid.test(relative[1]!));
}
async function load(cache: string, home: string): Promise<MaintenanceJournal | undefined> {
  const file = journalFile(cache); if (!await exists(file)) return undefined;
  try {
    if (!(await lstat(file)).isFile()) throw new Error("Unsafe maintenance journal");
    const envelope = record(JSON.parse(await readFile(file, "utf8")), "maintenance envelope", ["digest", "journal"]);
    const value = record(envelope.journal, "maintenance journal", ["format", "version", "id", "home", "cache", "rootDevice", "rootInode", "entries"]);
    if (value.format !== "harnessbrew.maintenance-journal" || value.version !== 1 || value.cache !== cache || value.home !== home || typeof value.id !== "string" || !uuid.test(value.id) || envelope.digest !== hash(canonicalJson(value)) || !Array.isArray(value.entries)) throw new Error("Invalid maintenance journal");
    const seen = new Set<string>();
    for (const [index, raw] of value.entries.entries()) {
      const e = record(raw, "maintenance entry", ["source", "quarantine", "digest", "tree", "phase", "reference"]);
      if (typeof e.source !== "string" || typeof e.reference !== "boolean" || !allowedSource(cache, e.source, e.reference) || seen.has(e.source) || e.quarantine !== path.join(cache, "maintenance", `trash-${value.id}`, String(index)) || !["pending", "quarantined", "deleting", "done"].includes(e.phase as string) || !Array.isArray(e.tree) || !e.tree.length || e.digest !== hash(canonicalJson(e.tree))) throw new Error("Invalid maintenance entry");
      seen.add(e.source); const paths = new Set<string>();
      for (const rawNode of e.tree) {
        const n = record(rawNode, "maintenance tree node", ["path", "device", "inode", "mode", "modifiedAt", "digest", "directory"]);
        if (typeof n.path !== "string" || path.isAbsolute(n.path) || n.path.split(path.sep).includes("..") || paths.has(n.path) || typeof n.device !== "string" || typeof n.inode !== "string" || !Number.isSafeInteger(n.mode) || typeof n.modifiedAt !== "number" || !Number.isFinite(n.modifiedAt) || (n.directory === true ? n.digest !== undefined : typeof n.digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(n.digest))) throw new Error("Invalid tree evidence");
        paths.add(n.path);
      }
      if (!paths.has("")) throw new Error("Missing root evidence");
    }
    return value as unknown as MaintenanceJournal;
  } catch (cause) { throw new HarnessError("RECOVERY_REQUIRED", "Maintenance journal is damaged; preserve it for inspection.", {}, { cause }); }
}
async function verifyCache(journal: MaintenanceJournal) {
  const stat = await lstat(journal.cache);
  if (!stat.isDirectory() || String(stat.dev) !== journal.rootDevice || String(stat.ino) !== journal.rootInode) conflict("Maintenance cache identity changed.");
  for (const directory of [path.join(journal.cache, "maintenance"), path.join(journal.cache, "maintenance", `trash-${journal.id}`)]) if (!(await lstat(directory)).isDirectory()) conflict("Unsafe maintenance quarantine parent.");
}
/** A partial deletion can only remove remaining exact recorded files; new files make rmdir fail closed. */
async function deleteTree(entry: Entry, fault: MaintenanceFault) {
  const nodes = [...entry.tree].sort((a, b) => b.path.split(path.sep).length - a.path.split(path.sep).length || b.path.length - a.path.length);
  const byPath = new Map(entry.tree.map(n => [n.path, n]));
  for (const node of nodes) {
    const file = path.join(entry.quarantine, node.path);
    let parent = path.dirname(node.path);
    while (node.path !== "" && parent !== ".") {
      const expected = byPath.get(parent); if (!expected?.directory) throw new HarnessError("RECOVERY_CONFLICT", "Missing maintenance ancestor evidence.");
      const actual = await lstat(path.join(entry.quarantine, parent)).catch(e => { if (e.code === "ENOENT") return undefined; throw e; });
      if (actual && (!actual.isDirectory() || String(actual.dev) !== expected.device || String(actual.ino) !== expected.inode)) conflict("Maintenance ancestor changed.");
      parent = path.dirname(parent);
    }
    const root = entry.tree.find(n => n.path === "")!;
    if (node.path !== "" && await exists(entry.quarantine)) {
      const actual = await lstat(entry.quarantine);
      if (!actual.isDirectory() || String(actual.dev) !== root.device || String(actual.ino) !== root.inode) conflict("Maintenance quarantine changed.");
    }
    const actual = await lstat(file).catch(e => { if (e.code === "ENOENT") return undefined; throw e; });
    if (!actual) continue;
    if (String(actual.dev) !== node.device || String(actual.ino) !== node.inode || actual.mode !== node.mode) conflict("Maintenance object identity changed.");
    if (node.directory) {
      if (!actual.isDirectory() || (await readdir(file)).length) conflict("Maintenance directory contains unrecorded data.");
      await rmdir(file);
    } else {
      if (!actual.isFile() || actual.mtimeMs !== node.modifiedAt || hash(await readFile(file)) !== node.digest) conflict("Maintenance file changed after quarantine.");
      await rm(file);
    }
    await syncDirectory(path.dirname(file)); await fault("entry-deleted", file);
  }
}
async function finish(journal: MaintenanceJournal, recovered: boolean, fault: MaintenanceFault): Promise<MaintenanceResult> {
  for (const entry of journal.entries) {
    await verifyCache(journal);
    if (entry.phase === "done") continue;
    if (entry.phase === "pending") {
      if (await exists(entry.source)) {
        if (await exists(entry.quarantine)) conflict("Both maintenance source and quarantine exist.");
        const tree = await inspectTree(entry.source); if (!tree.safe || tree.digest !== entry.digest) conflict("Maintenance source changed after intent was recorded.");
        if (!(await lstat(path.dirname(entry.source))).isDirectory()) conflict("Unsafe source parent.");
        await rename(entry.source, entry.quarantine); await syncDirectory(path.dirname(entry.source)); await syncDirectory(path.dirname(entry.quarantine));
      }
      if (!await exists(entry.quarantine) || (await inspectTree(entry.quarantine)).digest !== entry.digest) conflict("Quarantine does not match maintenance evidence.");
      entry.phase = "quarantined"; await save(journal); await fault("quarantined", entry.source);
    }
    if (entry.phase === "quarantined") {
      if ((await inspectTree(entry.quarantine)).digest !== entry.digest) conflict("Quarantine changed before deletion.");
      entry.phase = "deleting"; await save(journal); await fault("delete-recorded", entry.source);
    }
    await deleteTree(entry, fault); entry.phase = "done"; await save(journal);
  }
  const result: MaintenanceResult = { status: "complete", planId: journal.id, deleted: journal.entries.filter(e => !e.reference).map(e => e.source), retiredReferences: journal.entries.filter(e => e.reference).map(e => e.source), recovered };
  await rm(journalFile(journal.cache)); await syncDirectory(path.dirname(journalFile(journal.cache)));
  await rmdir(path.join(journal.cache, "maintenance", `trash-${journal.id}`)).catch(() => undefined);
  return result;
}
export async function executeMaintenance(store: StateStore, cache: string, id: string | undefined, fault: MaintenanceFault = () => undefined): Promise<MaintenanceResult | undefined> {
  if (id !== undefined && !uuid.test(id)) throw new HarnessError("PLAN_NOT_FOUND", "Unknown maintenance plan.");
  await cacheDirectory(cache, "maintenance");
  return store.withTransaction(async access => {
    if (await new JournalStore(store.home).load()) throw new HarnessError("RECOVERY_REQUIRED", "Recover the Home transaction before maintenance.");
    const result = await new CacheLeases(cache).tryMaintenance(async (resources, references) => {
      const existing = await load(cache, store.home);
      if (existing) {
        if (id !== undefined && existing.id !== id) throw new HarnessError("RECOVERY_REQUIRED", "Recover the pending maintenance before applying another preview.");
        return finish(existing, true, fault);
      }
      if (id === undefined) return undefined;
      const file = path.join(cache, "maintenance", `${id}.json`);
      if (!await exists(file)) throw new HarnessError("PLAN_NOT_FOUND", "Maintenance preview is unavailable.");
      if (!(await lstat(file)).isFile()) stale("Unsafe maintenance preview.");
      const envelope = JSON.parse(await readFile(file, "utf8")) as { digest: string; preview: MaintenancePreview };
      const preview = envelope.preview;
      if (envelope.digest !== hash(canonicalJson(preview)) || preview.format !== "harnessbrew.maintenance-plan" || preview.version !== 1 || preview.planId !== id || preview.home !== store.home || preview.cache !== cache || !Number.isSafeInteger(preview.createdAt) || preview.createdAt > Date.now()) stale("Invalid maintenance preview.");
      const state = await access.read();
      const actual = await maintenanceSnapshot(store.home, cache, state, preview.policy, preview.createdAt, { activeLease: false, resources: [...resources], references: [...references] });
      const { planId: ignored, ...expected } = preview; void ignored;
      if (canonicalJson(actual) !== canonicalJson(expected)) stale("Maintenance inputs or references changed after preview.");
      if (actual.diagnostics.length) stale("Maintenance protection evidence is unknown.");
      const candidates = [...actual.objects.filter(o => o.status === "deletable").map(o => ({ path: o.path, digest: actual.fingerprints.find(f => f.path === o.path)!.digest, reference: false })), ...actual.retiredReferences.map(r => ({ ...r, reference: true }))];
      const quarantine = await cacheDirectory(path.join(cache, "maintenance"), `trash-${id}`);
      if ((await readdir(quarantine)).length) conflict("Maintenance quarantine is not empty.");
      const entries: Entry[] = [];
      for (const candidate of candidates) {
        if (!allowedSource(cache, candidate.path, candidate.reference)) stale("Unsupported maintenance candidate.");
        const tree = await inspectTree(candidate.path); if (!tree.safe || tree.digest !== candidate.digest) stale("Maintenance candidate changed.");
        entries.push({ source: candidate.path, quarantine: path.join(quarantine, String(entries.length)), digest: tree.digest, tree: tree.entries, phase: "pending", reference: candidate.reference });
      }
      const root = await lstat(cache);
      const journal: MaintenanceJournal = { format: "harnessbrew.maintenance-journal", version: 1, id, home: store.home, cache, rootDevice: String(root.dev), rootInode: String(root.ino), entries };
      await save(journal); await fault("journal-durable"); return finish(journal, false, fault);
    });
    if (!result.ran) throw new HarnessError("PLAN_STALE", "Active cache leases prevent maintenance; retry after the operations finish.");
    return result.value;
  });
}
