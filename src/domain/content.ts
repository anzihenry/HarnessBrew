import { inventory, inventoryDigest, resolvedAsset, sourceSnapshot, type InventoryEntry, type ResolvedAsset, type SourceSnapshot } from "./assets.js";
import type { CatalogSnapshot } from "./catalog.js";
import { coordinate, digest, type Coordinate, type Digest } from "./identity.js";
import type { InstalledAsset } from "./state.js";
import { array, canonicalJson, invalid, record, sortBy, unique } from "./validation.js";

export interface ContentRecord { digest: Digest; inventory: InventoryEntry[]; origins: { coordinate: Coordinate; snapshot: SourceSnapshot }[] }
export function parseContents(value: unknown): ContentRecord[] {
  return sortBy(unique(array(value, "content inventory", raw => {
    const item = record(raw, "content record", ["digest", "inventory", "origins"]);
    const entries = inventory(item.inventory), id = digest(item.digest);
    if (inventoryDigest(entries) !== id) invalid("content inventory digest");
    const origins = unique(array(item.origins, "content origins", raw => {
      const origin = record(raw, "content origin", ["coordinate", "snapshot"]);
      const name = coordinate(origin.coordinate), snapshot = sourceSnapshot(origin.snapshot);
      if (!name.startsWith(`${snapshot.tap}/`)) invalid("content origin source");
      return { coordinate: name, snapshot };
    }), origin => `${origin.coordinate}:${origin.snapshot.id}`, "content origins");
    if (!origins.length) invalid("empty content origins");
    return { digest: id, inventory: entries, origins: sortBy(origins, origin => `${origin.coordinate}:${origin.snapshot.id}`) };
  }), item => item.digest, "content digests"), item => item.digest);
}
export function registerContents(existing: readonly ContentRecord[], assets: readonly ResolvedAsset[], catalog: CatalogSnapshot): ContentRecord[] {
  const records = new Map(structuredClone(existing).map(item => [item.digest, item]));
  for (const raw of assets) {
    const asset = resolvedAsset(raw), snapshot = catalog.snapshots.find(s => s.id === asset.snapshotId);
    if (!snapshot) invalid("content source snapshot");
    const current = records.get(asset.contentDigest) ?? { digest: asset.contentDigest, inventory: asset.inventory, origins: [] };
    if (canonicalJson(current.inventory) !== canonicalJson(asset.inventory)) invalid("conflicting content inventory");
    if (!current.origins.some(o => o.coordinate === asset.manifest.coordinate && o.snapshot.id === snapshot.id)) current.origins.push({ coordinate: asset.manifest.coordinate, snapshot });
    records.set(current.digest, current);
  }
  return parseContents([...records.values()]);
}
export function contentReferences(assets: readonly InstalledAsset[], id: Digest): Coordinate[] {
  return assets.filter(a => a.status === "active" && a.contentDigest === id).map(a => a.coordinate).sort();
}
