import { randomUUID } from "node:crypto";
import path from "node:path";
import { loadCatalog } from "../catalog/load.js";
import type { CatalogSnapshot } from "../domain/catalog.js";
import type { HomeState } from "../domain/home-state.js";
import { sameSnapshot, type SourceSnapshot } from "../domain/assets.js";
import { resolveAsset } from "../domain/identity.js";
import { HarnessError } from "../domain/errors.js";
import { sameVersion } from "../domain/catalog-index.js";
import { canonicalJson } from "../domain/validation.js";
import { SourceManager } from "../sources/manager.js";
import { catalogAssetReader } from "../ports/planning.js";
import { stageContent } from "../execution/content.js";
import { cacheDirectory } from "./cache.js";

/** Prepare verified bytes outside the write transaction. Never changes Home or target resources. */
export async function prepareRestore(state: HomeState, query: string, cache: string) {
  const asset = resolveAsset(state.install.assets.filter(a => a.status === "active"), query);
  const content = state.contents.find(c => c.digest === asset.contentDigest)!;
  const origin = content.origins.find(o => o.coordinate === asset.coordinate && o.snapshot.id === asset.snapshotId)!;
  const registration = state.sources.registrations.find(s => s.name === origin.snapshot.tap);
  if (!registration?.trusted || registration.url !== origin.snapshot.url) throw new HarnessError("SOURCE_UNTRUSTED", "Content restoration requires the original trusted source.");
  await cacheDirectory(cache, "restores");
  const working = path.join(cache, "restores", randomUUID());
  let snapshot: SourceSnapshot = origin.snapshot, exact: CatalogSnapshot;
  try { exact = await loadCatalog([snapshot], []); }
  catch {
    snapshot = await new SourceManager(path.join(working, "sources")).prepare({ name: snapshot.tap, url: snapshot.url, commit: snapshot.commit });
    if (!sameSnapshot(snapshot, origin.snapshot)) throw new HarnessError("CONTENT_MODIFIED", "Recovered source differs from the recorded Git snapshot.");
    exact = await loadCatalog([snapshot], []);
  }
  const resolved = exact.assets.find(a => a.manifest.coordinate === asset.coordinate && sameVersion({ coordinate: a.manifest.coordinate, ...a }, asset));
  if (!resolved || canonicalJson(resolved.inventory) !== canonicalJson(content.inventory)) throw new HarnessError("CONTENT_MODIFIED", "Recovery bytes do not match the installed content inventory.");
  // Include available snapshots for unchanged placements; missing unrelated caches can be retained from committed operations.
  const snapshots = new Map([[snapshot.id, snapshot]]), assets = [...exact.assets];
  for (const previous of state.sources.snapshots) {
    if (snapshots.has(previous.id)) continue;
    try { const available = await loadCatalog([previous], []); snapshots.set(previous.id, previous); assets.push(...available.assets); } catch { /* Unchanged operations use committed evidence. */ }
  }
  const catalog: CatalogSnapshot = { snapshots: [...snapshots.values()], assets, selectedSnapshotIds: [] };
  // stageContent requires its parent; cacheDirectory also rejects symlink caches.
  await cacheDirectory(working, "staged");
  const staged = path.join(working, "staged", content.digest.slice(7));
  await stageContent(staged, resolved, catalogAssetReader(catalog));
  return { baseRevision: state.revision, digest: content.digest, staged, catalog, commit: asset.commit };
}
