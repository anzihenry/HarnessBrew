import { randomUUID } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { hash } from "../domain/identity.js";
import { canonicalJson, record } from "../domain/validation.js";
import type { HomeState } from "../domain/home-state.js";
import { atomicDocument } from "../execution/files.js";
import { CacheLeases } from "./cache-leases.js";
import { cacheDirectory } from "./cache.js";
import { parsePrepared } from "./plan-store.js";
import { evaluateRetention, retentionPolicy, stateReferences, type RetentionPolicy, type RetentionObject, type RetentionReport, type RetentionKnowledge } from "./retention.js";

export interface MaintenancePreview extends RetentionReport {
  format: "harnessbrew.maintenance-plan"; version: 1; planId: string; home: string; cache: string;
  baseRevision: string; createdAt: number; policy: RetentionPolicy;
  fingerprints: { path: string; digest: string }[]; referencesDigest: string; diagnostics: string[];
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
/** No symlink following, including within a candidate directory. Fingerprints include identity and bytes. */
async function inspectTree(file: string): Promise<{ bytes: number; modifiedAt: number; digest: string; safe: boolean }> {
  const entries: unknown[] = []; let bytes = 0, safe = true, modifiedAt = 0;
  async function visit(current: string): Promise<void> {
    const stat = await lstat(current); modifiedAt = Math.max(modifiedAt, Math.floor(stat.mtimeMs));
    const identity = { path: path.relative(file, current), device: String(stat.dev), inode: String(stat.ino), mode: stat.mode, modifiedAt: stat.mtimeMs };
    if (stat.isFile()) { const content = await readFile(current); bytes += content.length; entries.push({ ...identity, digest: hash(content) }); }
    else if (stat.isDirectory()) { entries.push(identity); for (const name of (await readdir(current)).sort()) await visit(path.join(current, name)); }
    else { safe = false; entries.push({ ...identity, unsupported: true }); }
  }
  await visit(file);
  return { bytes, modifiedAt, digest: hash(canonicalJson(entries)), safe };
}
export async function maintenanceSnapshot(home: string, cache: string, state: HomeState, policy: Partial<RetentionPolicy> = {}, now = Date.now()): Promise<Omit<MaintenancePreview, "planId">> {
  await cacheDirectory(cache, "maintenance");
  const parsedPolicy = retentionPolicy(policy), objects: RetentionObject[] = [], fingerprints: MaintenancePreview["fingerprints"] = [];
  const knowledge: RetentionKnowledge = { references: stateReferences(home, cache, state), activeLease: false, unknown: [] };
  try {
    const leases = await new CacheLeases(cache).inspect(); knowledge.activeLease = leases.activeLease;
    knowledge.references.push(...leases.resources.map(p => ({ path: p, reason: "saved-plan-reference" })));
  } catch { knowledge.unknown.push("unreadable-cache-protection"); }
  for (const [directory, kind] of [["plans", "plan"], ["prepared", "prepared"], ["restores", "restore"]] as const) {
    const parent = path.join(cache, directory);
    try {
      if (!(await lstat(parent)).isDirectory()) { knowledge.unknown.push(`unsafe-${directory}-directory`); continue; }
      for (const name of (await readdir(parent)).sort()) {
        const file = path.join(parent, name);
        try {
          const tree = await inspectTree(file), stat = await lstat(file);
          let owned = tree.safe && (kind === "plan" ? stat.isFile() && name.endsWith(".json") && uuid.test(name.slice(0, -5)) : stat.isDirectory() && uuid.test(name));
          if (kind !== "plan" && owned) {
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
            } catch { owned = false; knowledge.unknown.push("unreadable-saved-plan"); }
          }
          objects.push({ path: file, kind, bytes: tree.bytes, modifiedAt: tree.modifiedAt, owned }); fingerprints.push({ path: file, digest: tree.digest });
        } catch { objects.push({ path: file, kind, bytes: 0, modifiedAt: now, owned: false }); knowledge.unknown.push("candidate-changed-during-inspection"); }
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") knowledge.unknown.push(`unreadable-${directory}-directory`); }
  }
  // Other cache domains are deliberately retained until their ownership rules are implemented.
  for (const name of (await readdir(cache)).sort()) {
    if (["plans", "prepared", "restores", "leases", "references", ".leases.guard", "maintenance"].includes(name)) continue;
    const file = path.join(cache, name);
    const stat = await lstat(file);
    objects.push({ path: file, kind: "unknown", bytes: stat.isFile() ? stat.size : 0, modifiedAt: Math.floor(stat.mtimeMs), owned: false });
  }
  return { format: "harnessbrew.maintenance-plan", version: 1, home, cache, baseRevision: state.revision, createdAt: now, policy: parsedPolicy,
    ...evaluateRetention(objects, knowledge, parsedPolicy, now), fingerprints, referencesDigest: hash(canonicalJson(knowledge)), diagnostics: knowledge.unknown };
}
export async function previewMaintenance(home: string, cache: string, state: HomeState, policy: Partial<RetentionPolicy> = {}): Promise<MaintenancePreview> {
  const snapshot = await maintenanceSnapshot(home, cache, state, policy);
  const preview: MaintenancePreview = { ...snapshot, planId: randomUUID() };
  const directory = await cacheDirectory(cache, "maintenance");
  await atomicDocument(path.join(directory, `${preview.planId}.json`), { digest: hash(canonicalJson(preview)), preview });
  return preview;
}
