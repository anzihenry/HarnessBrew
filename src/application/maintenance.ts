import { randomUUID } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { hash, stableId } from "../domain/identity.js";
import { sourceSnapshot } from "../domain/assets.js";
import { inspectContent } from "../sources/inventory.js";
import { inspectPlugin } from "./adapters.js";
import { canonicalJson, format, record } from "../domain/validation.js";
import { parseHomeState, type HomeState } from "../domain/home-state.js";
import { HarnessError } from "../domain/errors.js";
import { atomicDocument, exists } from "../execution/files.js";
import { CacheLeases, type CacheProtection } from "./cache-leases.js";
import { cacheDirectory } from "./cache.js";
import { parsePrepared } from "./plan-store.js";
import { evaluateRetention, planExpired, retentionPolicy, stateReferences, type RetentionPolicy, type RetentionObject, type RetentionReport, type RetentionKnowledge } from "./retention.js";

export interface MaintenancePreview extends RetentionReport {
  format: "harnessbrew.maintenance-plan"; version: 1; planId: string; home: string; cache: string;
  baseRevision: string; createdAt: number; policy: RetentionPolicy;
  retiredReferences: { path: string; digest: string }[];
  fingerprints: { path: string; digest: string }[]; referencesDigest: string; diagnostics: string[];
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
/** No symlink following, including within a candidate directory. Fingerprints include identity and bytes. */
export interface MaintenanceTreeEntry { path: string; device: string; inode: string; mode: number; modifiedAt: number; digest?: string; directory?: boolean; unsupported?: boolean }
export async function inspectTree(file: string): Promise<{ bytes: number; modifiedAt: number; digest: string; safe: boolean; entries: MaintenanceTreeEntry[] }> {
  const entries: MaintenanceTreeEntry[] = []; let bytes = 0, safe = true, modifiedAt = 0;
  async function visit(current: string): Promise<void> {
    const stat = await lstat(current); modifiedAt = Math.max(modifiedAt, Math.floor(stat.mtimeMs));
    const identity = { path: path.relative(file, current), device: String(stat.dev), inode: String(stat.ino), mode: stat.mode, modifiedAt: stat.mtimeMs };
    if (stat.isFile()) { const content = await readFile(current); bytes += content.length; entries.push({ ...identity, digest: hash(content) }); }
    else if (stat.isDirectory()) { entries.push({ ...identity, directory: true }); for (const name of (await readdir(current)).sort()) await visit(path.join(current, name)); }
    else { safe = false; entries.push({ ...identity, unsupported: true }); }
  }
  await visit(file);
  return { bytes, modifiedAt, digest: hash(canonicalJson(entries)), safe, entries };
}
export async function maintenanceSnapshot(home: string, cache: string, state: HomeState, policy: Partial<RetentionPolicy> = {}, now = Date.now(), protection?: CacheProtection, excludeMaintenancePlan?: string): Promise<Omit<MaintenancePreview, "planId">> {
  await cacheDirectory(cache, "maintenance");
  if (!protection && await exists(path.join(cache, "maintenance", "transaction.json"))) throw new HarnessError("RECOVERY_REQUIRED", "Recover pending maintenance before generating another preview.");
  const parsedPolicy = retentionPolicy(policy), objects: RetentionObject[] = [], fingerprints: MaintenancePreview["fingerprints"] = [];
  const retiredReferences: MaintenancePreview["retiredReferences"] = [];
  const knowledge: RetentionKnowledge = { references: stateReferences(home, cache, state), activeLease: false, unknown: [] };
  try {
    const leases = protection ?? await new CacheLeases(cache).inspect(); knowledge.activeLease = leases.activeLease;
    for (const reference of leases.references) {
      const planFile = path.join(cache, "plans", `${reference.id}.json`);
      let retired = false;
      // Cross-cache references remain protected; another cache's producer cannot be excluded by this guard.
      if (!leases.activeLease && reference.resources.includes(planFile) && reference.resources.every(p => p.startsWith(`${cache}${path.sep}`))) {
        const stat = await lstat(planFile);
        if (stat.isFile() && planExpired(stat.mtimeMs, now)) {
          const envelope = record(JSON.parse(await readFile(planFile, "utf8")), "plan envelope", ["digest", "saved"]);
          const saved = parsePrepared(envelope.saved);
          if (saved.id !== reference.id || saved.home !== home || envelope.digest !== hash(canonicalJson(saved)) || canonicalJson([...new Set([...saved.resources, planFile])].sort()) !== canonicalJson([...new Set(reference.resources)].sort())) throw new Error("Invalid expired reference");
          const referenceFile = path.join(cache, "references", `${reference.id}.json`);
          retiredReferences.push({ path: referenceFile, digest: (await inspectTree(referenceFile)).digest }); retired = true;
        }
      }
      if (!retired) knowledge.references.push(...reference.resources.map(p => ({ path: p, reason: "saved-plan-reference" })));
    }
  } catch { knowledge.unknown.push("unreadable-cache-protection"); }
  for (const [directory, kind] of [["plans", "plan"], ["prepared", "prepared"], ["restores", "restore"], ["sources/snapshots", "source"], ["plugins", "plugin"], ["revisions", "revision"], ["maintenance", "maintenance-plan"]] as const) {
    const parent = path.join(kind === "revision" ? home : cache, directory);
    try {
      if (kind === "source" && !(await lstat(path.join(cache, "sources"))).isDirectory()) { knowledge.unknown.push("unsafe-sources-directory"); continue; }
      if (!(await lstat(parent)).isDirectory()) { knowledge.unknown.push(`unsafe-${directory}-directory`); continue; }
      for (const name of (await readdir(parent)).sort()) {
        if (kind === "maintenance-plan" && name === `${excludeMaintenancePlan}.json`) continue;
        const file = path.join(parent, name);
        try {
          const tree = await inspectTree(file), stat = await lstat(file);
          let owned = tree.safe && (["plan", "revision", "maintenance-plan"].includes(kind) ? stat.isFile() && name.endsWith(".json") && uuid.test(name.slice(0, -5)) : stat.isDirectory() && (kind === "source" || kind === "plugin" ? /^[a-f0-9]{64}$/u.test(name) : uuid.test(name)));
          if ((kind === "prepared" || kind === "restore") && owned) {
            try {
              const marker = path.join(file, ".owner.json");
              if (!(await lstat(marker)).isFile()) throw new Error("Unsafe owner receipt");
              const receipt = record(JSON.parse(await readFile(marker, "utf8")), "cache owner envelope", ["value", "digest"]);
              const value = record(receipt.value, "cache owner", ["format", "version", "id", "purpose"]);
              owned = value.format === "harnessbrew.cache-owner" && value.version === 1 && value.id === name && value.purpose === kind && receipt.digest === hash(canonicalJson(value));
            } catch { owned = false; }
          }
          if (kind === "plan" && owned) {
            try {
              const envelope = record(JSON.parse(await readFile(file, "utf8")), "plan envelope", ["digest", "saved"]);
              const saved = parsePrepared(envelope.saved);
              if (envelope.digest !== hash(canonicalJson(saved)) || `${saved.id}.json` !== name || saved.home !== home) throw new Error("Plan identity mismatch");
              if (!planExpired(stat.mtimeMs, now)) knowledge.references.push({ path: path.join(home, "revisions", `${saved.baseRevision}.json`), reason: "valid-plan-base-revision" });
            } catch { owned = false; knowledge.unknown.push("unreadable-saved-plan"); }
          }
          if (kind === "revision" && owned) {
            try { owned = `${parseHomeState(JSON.parse(await readFile(file, "utf8"))).revision}.json` === name; }
            catch { owned = false; }
          }
          if (kind === "maintenance-plan" && owned) {
            try {
              const envelope = record(JSON.parse(await readFile(file, "utf8")), "maintenance plan envelope", ["digest", "preview"]);
              const preview = record(envelope.preview, "maintenance preview", ["format", "version", "planId", "home", "cache", "baseRevision", "createdAt", "policy", "objects", "totalBytes", "retainedBytes", "protectedBytes", "overBudgetBytes", "retiredReferences", "fingerprints", "referencesDigest", "diagnostics"]);
              owned = preview.format === "harnessbrew.maintenance-plan" && preview.version === 1 && `${preview.planId}.json` === name && preview.home === home && preview.cache === cache && envelope.digest === hash(canonicalJson(preview));
            } catch { owned = false; }
          }
          if (kind === "source" && owned) {
            try {
              if (canonicalJson((await readdir(file)).sort()) !== canonicalJson(["content", "snapshot.json"])) throw new Error("Unknown snapshot files");
              const value = format(JSON.parse(await readFile(path.join(file, "snapshot.json"), "utf8")), "harnessbrew.source-snapshot", ["snapshot"]);
              const snapshot = sourceSnapshot(value.snapshot);
              owned = snapshot.id === name && snapshot.id === stableId({ tap: snapshot.tap, url: snapshot.url, commit: snapshot.commit }) && snapshot.contentLocation === path.join(file, "content") && (await inspectContent(snapshot.contentLocation)).digest === snapshot.treeDigest;
            } catch { owned = false; }
          }
          if (kind === "plugin" && owned) {
            try { owned = (await inspectPlugin(file, [])).signature === `sha256:${name}`; }
            catch { owned = false; }
          }
          objects.push({ path: file, kind, bytes: tree.bytes, modifiedAt: tree.modifiedAt, owned }); fingerprints.push({ path: file, digest: tree.digest });
        } catch { objects.push({ path: file, kind, bytes: 0, modifiedAt: now, owned: false }); knowledge.unknown.push("candidate-changed-during-inspection"); }
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") knowledge.unknown.push(`unreadable-${directory}-directory`); }
  }
  // Other cache domains are deliberately retained until their ownership rules are implemented.
  for (const name of (await readdir(cache)).sort()) {
    if (["plans", "prepared", "restores", "plugins", "leases", "references", ".leases.guard", "maintenance"].includes(name)) continue;
    const file = path.join(cache, name);
    const stat = await lstat(file);
    objects.push({ path: file, kind: "unknown", bytes: stat.isFile() ? stat.size : 0, modifiedAt: Math.floor(stat.mtimeMs), owned: false });
  }
  return { format: "harnessbrew.maintenance-plan", version: 1, home, cache, baseRevision: state.revision, createdAt: now, policy: parsedPolicy,
    ...evaluateRetention(objects, knowledge, parsedPolicy, now), retiredReferences, fingerprints, referencesDigest: hash(canonicalJson(knowledge)), diagnostics: knowledge.unknown };
}
export async function previewMaintenance(home: string, cache: string, state: HomeState, policy: Partial<RetentionPolicy> = {}): Promise<MaintenancePreview> {
  const snapshot = await maintenanceSnapshot(home, cache, state, policy);
  const preview: MaintenancePreview = { ...snapshot, planId: randomUUID() };
  const directory = await cacheDirectory(cache, "maintenance");
  await atomicDocument(path.join(directory, `${preview.planId}.json`), { digest: hash(canonicalJson(preview)), preview });
  return preview;
}
