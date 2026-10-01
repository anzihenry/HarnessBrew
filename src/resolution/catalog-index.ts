import { resolvedAsset, sourceSnapshot, type ResolvedAsset } from "../domain/assets.js";
import { freezeData, type CatalogSnapshot } from "../domain/catalog.js";
import { HarnessError } from "../domain/errors.js";
import { canonicalJson, unique } from "../domain/validation.js";
import type { AssetPin } from "../domain/state.js";
import type { Coordinate } from "../domain/identity.js";

export function sameVersion(left: AssetPin, right: AssetPin): boolean {
  return left.coordinate === right.coordinate && left.contentDigest === right.contentDigest && canonicalJson(left.commit) === canonicalJson(right.commit);
}
/** Indexed once, then shared by all roots and owners in one resolution. */
export class CatalogIndex {
  readonly snapshot: CatalogSnapshot;
  readonly latest = new Map<Coordinate, ResolvedAsset>();
  private readonly versions = new Map<Coordinate, ResolvedAsset[]>();
  constructor(input: CatalogSnapshot) {
    const snapshots = unique(input.snapshots.map(sourceSnapshot), item => item.id, "catalog snapshots");
    const byId = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]));
    const selected = unique([...input.selectedSnapshotIds], id => id, "selected snapshots");
    const selectedTaps = selected.map(id => {
      const snapshot = byId.get(id);
      if (!snapshot) throw new HarnessError("SOURCE_NOT_FOUND", `Selected snapshot missing: ${id}`);
      return snapshot.tap;
    });
    unique(selectedTaps, tap => tap, "selected Tap versions");
    const assets = input.assets.map(resolvedAsset);
    unique(assets, asset => `${asset.snapshotId}:${asset.manifest.coordinate}`, "catalog asset versions");
    for (const asset of assets) {
      const snapshot = byId.get(asset.snapshotId);
      if (!snapshot || snapshot.tap !== asset.manifest.coordinate.split("/").slice(0, 2).join("/") || canonicalJson(asset.commit) !== canonicalJson(snapshot.commit)) {
        throw new HarnessError("INVALID_STATE", "Catalog asset does not belong to its source snapshot.");
      }
      const versions = this.versions.get(asset.manifest.coordinate) ?? [];
      if (versions.some(previous => canonicalJson(previous.commit) === canonicalJson(asset.commit))) throw new HarnessError("SOURCE_MISMATCH", "Conflicting provenance for a catalog version.");
      versions.push(asset);
      this.versions.set(asset.manifest.coordinate, versions);
      if (selected.includes(asset.snapshotId)) this.latest.set(asset.manifest.coordinate, asset);
    }
    this.snapshot = freezeData({ snapshots, selectedSnapshotIds: selected, assets });
  }
  pinned(pin: AssetPin): ResolvedAsset | undefined {
    return this.versions.get(pin.coordinate)?.find(asset => sameVersion({ coordinate: asset.manifest.coordinate, ...asset }, pin));
  }
}
