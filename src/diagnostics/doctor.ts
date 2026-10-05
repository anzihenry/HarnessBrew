import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { StateStore } from "../storage/state-store.js";
import { JournalStore } from "../transactions/journal.js";
import { HarnessError } from "../domain/errors.js";
import { identifier } from "../domain/identity.js";
import { dependencyClosure, assertNoConflicts } from "../domain/graph.js";
import { resourcesConflict } from "../domain/state.js";
import type { HomeState } from "../domain/home-state.js";
import { canonicalJson } from "../domain/validation.js";
import { image, exists } from "../execution/files.js";
import { nodePlanningIO } from "../ports/planning.js";
import { resourceFingerprint } from "../planning/resources.js";
import type { DoctorFinding, DoctorReport } from "../application/types.js";

/** Holds the Home lock; malformed records never imply a healthy or complete report. */
export async function diagnose(store: StateStore, coordinate?: string): Promise<DoctorReport> {
  return store.withTransaction(async access => {
    const findings: DoctorFinding[] = []; let complete = true;
    const add = (category: DoctorFinding["category"], error: unknown, extra: Partial<DoctorFinding> = {}) => {
      findings.push({ category, code: error instanceof HarnessError ? error.code : "STATE_CORRUPT", severity: "error", message: error instanceof Error ? error.message : String(error), actions: [], ...extra });
    };
    try { if (await new JournalStore(store.home).load()) { complete = false; add("state", new HarnessError("RECOVERY_REQUIRED", "Unfinished transaction; run recover before using installation state."), { actions: ["recover"] }); } }
    catch (error) { complete = false; add("state", error); }
    let state: HomeState;
    try { state = await access.read(); }
    catch (error) {
      complete = false; add("state", error);
      // Best-effort inspection is diagnostic only, and never trusts records for mutation.
      try {
        const pointer = JSON.parse(await readFile(path.join(store.home, "CURRENT"), "utf8"));
        state = JSON.parse(await readFile(path.join(store.home, "revisions", `${identifier(pointer.revision)}.json`), "utf8"));
        if (!Array.isArray(state.install?.assets) || !Array.isArray(state.install?.operations)) return { healthy: false, complete: false, findings };
      } catch { return { healthy: false, complete: false, findings }; }
    }
    if (coordinate) {
      const matches = state.install.assets.filter(a => typeof a?.coordinate === "string" && (a.coordinate === coordinate || !coordinate.includes("/") && a.coordinate.endsWith(`/${coordinate}`)));
      if (matches.length > 1) throw new HarnessError("AMBIGUOUS_ASSET", "Doctor asset name is ambiguous.", { candidates: matches.map(a => a.coordinate) });
      if (!matches.length && complete) throw new HarnessError("ASSET_NOT_FOUND", "Doctor asset is not installed.");
    }
    const assets = state.install.assets.filter(a => a && a.status === "active");
    for (const asset of state.install.assets) {
      if (coordinate && asset?.coordinate !== coordinate && !(typeof asset?.coordinate === "string" && asset.coordinate.endsWith(`/${coordinate}`))) continue;
      if (!asset || !/^sha256:[a-f0-9]{64}$/u.test(asset.contentDigest) || !state.contents?.some(c => c?.digest === asset.contentDigest)) add("content", new Error("Asset has no valid content inventory reference."), { asset: asset?.coordinate });
      if (asset?.status === "active") try { dependencyClosure(asset.coordinate, name => assets.find(a => a.coordinate === name)); assertNoConflicts(assets); }
      catch (error) { add("dependency", error, { asset: asset.coordinate }); }
    }
    const contents = Array.isArray(state.contents) ? state.contents : [];
    if (!Array.isArray(state.contents)) { complete = false; add("state", new Error("Content inventory is missing.")); }
    for (const content of contents) {
      const affectedAssets = assets.filter(a => a.contentDigest === content?.digest).map(a => a.coordinate);
      if (coordinate && !state.install.assets.some(a => a.contentDigest === content?.digest && (a.coordinate === coordinate || a.coordinate.endsWith(`/${coordinate}`)))) continue;
      try {
        if (!content || !/^sha256:[a-f0-9]{64}$/u.test(content.digest)) throw new Error("Malformed content inventory.");
        const resource = path.join(store.home, "content", content.digest.slice(7));
        const actual = await image(resource, true);
        if (actual.kind !== "content" || actual.digest !== content.digest) findings.push({ category: "content", code: actual.kind === "missing" ? "CONTENT_MISSING" : "CONTENT_MODIFIED", severity: "error", message: actual.kind === "missing" ? "Managed content is missing." : "Managed content was modified.", digest: content.digest, affectedAssets, resource, actions: affectedAssets.length ? [actual.kind === "missing" ? "repair" : "repair --restore-content"] : actual.kind === "missing" ? ["cleanup"] : ["inspect"] });
        else if (!affectedAssets.length) findings.push({ category: "content", code: "CONTENT_UNREFERENCED", severity: "info", message: "Managed content has no active references.", digest: content.digest, affectedAssets, resource, actions: ["cleanup --dry-run"] });
      } catch (error) { add("content", error, { digest: content?.digest, affectedAssets, actions: ["inspect"] }); }
    }
    if (!coordinate) {
      try {
        const root = path.join(store.home, "content");
        if (await exists(root)) {
          if (!(await lstat(root)).isDirectory()) throw new Error("Content root must be a directory.");
          for (const name of await readdir(root)) if (!contents.some(c => c?.digest === `sha256:${name}`)) findings.push({ category: "content", code: "CONTENT_UNREGISTERED", severity: "warning", message: "Unregistered content is preserved and will not be reclaimed.", resource: path.join(root, name), actions: ["inspect"] });
        }
        for (const quarantine of state.quarantines ?? []) findings.push({ category: "content", code: "CONTENT_QUARANTINED", severity: "info", message: "Original content was preserved during repair; inspect the recorded location before manual disposal.", digest: quarantine.digest, resource: quarantine.path, actions: ["inspect"] });
      } catch (error) { complete = false; add("content", error); }
    }
    for (const operation of state.install.operations) {
      if (coordinate && operation?.asset !== coordinate && !(typeof operation?.asset === "string" && operation.asset.endsWith(`/${coordinate}`))) continue;
      try {
        if (!operation?.resource || typeof operation.resource.path !== "string" || !path.isAbsolute(operation.resource.path)) throw new HarnessError("STATE_CORRUPT", "Malformed operation record.");
        const actual = resourceFingerprint(await nodePlanningIO.inspect(operation.resource.path), operation.resource);
        if (canonicalJson(actual) !== canonicalJson(operation.installedFingerprint)) add("target", new HarnessError("TARGET_MODIFIED", actual.kind === "missing" ? "Managed target is missing." : "Managed target was modified."), { asset: operation.asset, operation: operation.id, resource: operation.resource.path, actions: actual.kind === "missing" ? ["repair"] : ["inspect", "repair --overwrite-owned (verified ownership required)"] });
      } catch (error) { add("target", error, { ...(typeof operation?.id === "string" ? { operation: operation.id } : {}) }); }
    }
    for (let i = 0; i < state.install.operations.length; i++) for (const other of state.install.operations.slice(i + 1)) {
      try { if (resourcesConflict(state.install.operations[i]!.resource, other.resource)) add("ownership", new HarnessError("OWNERSHIP_CONFLICT", "Overlapping operation ownership."), { operation: other.id }); }
      catch (error) { complete = false; add("state", error); }
    }
    return { healthy: complete && !findings.some(f => f.severity === "error"), complete, findings };
  });
}
