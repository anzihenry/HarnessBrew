import { measured } from "../observability/measure.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { manifest, inventoryDigest, resolvedAsset, sourceSnapshot, type ResolvedAsset, type SourceSnapshot } from "../domain/assets.js";
import { freezeData, type CatalogSnapshot } from "../domain/catalog.js";
import { HarnessError } from "../domain/errors.js";
import { coordinate, identifier } from "../domain/identity.js";
import { format, sortBy, unique } from "../domain/validation.js";
import { inspectContent } from "../sources/inventory.js";

/** One verified inventory scan per source snapshot per operation. No global mutable catalog. */
export async function loadCatalog(snapshots: readonly SourceSnapshot[], selectedSnapshotIds: readonly string[]): Promise<CatalogSnapshot> {
  return measured("catalog.load", async () => {
  const sources = unique(snapshots.map(sourceSnapshot), snapshot => snapshot.id, "catalog snapshots");
  const selected = unique([...selectedSnapshotIds], id => id, "selected snapshots");
  const selectedSources = selected.map(id => {
    const snapshot = sources.find(snapshot => snapshot.id === id);
    if (!snapshot) throw new HarnessError("SOURCE_NOT_FOUND", `Selected snapshot is missing: ${id}`);
    return snapshot;
  });
  unique(selectedSources, snapshot => snapshot.tap, "selected Tap versions");
  const assets: ResolvedAsset[] = [];
  for (const snapshot of sources) {
    const tree = await inspectContent(snapshot.contentLocation);
    if (tree.digest !== snapshot.treeDigest) throw new HarnessError("CONTENT_MODIFIED", `Source inventory changed: ${snapshot.id}`);
    if (!tree.entries.some(entry => entry.path === "tap.json" && entry.type === "file")) throw new HarnessError("UNSUPPORTED_FORMAT", "Source requires tap.json.");
    format(await readJson(path.join(snapshot.contentLocation, "tap.json")), "harnessbrew.tap", []);
    if (tree.entries.some(entry => entry.path === "assets" && entry.type !== "directory")) throw new HarnessError("INVALID_STATE", "assets must be a directory.");
    const names = tree.entries.filter(entry => /^assets\/[^/]+$/u.test(entry.path)).map(entry => {
      if (entry.type !== "directory") throw new HarnessError("INVALID_STATE", "Each assets entry must be a directory.");
      return identifier(entry.path.slice("assets/".length));
    });
    for (const name of names) {
      const prefix = `assets/${name}/`;
      const entries = tree.entries.filter(entry => entry.path.startsWith(prefix)).map(entry => ({ ...entry, path: entry.path.slice(prefix.length) }));
      if (!entries.some(entry => entry.path === "asset.json" && entry.type === "file")) throw new HarnessError("UNSUPPORTED_FORMAT", `Asset ${name} requires asset.json.`);
      const declaration = format(await readJson(path.join(snapshot.contentLocation, prefix, "asset.json")), "harnessbrew.asset", ["kind", "entry", "description", "dependencies", "conflicts", "targets"]);
      const { format: _format, version: _version, ...fields } = declaration;
      const assetManifest = manifest({ ...fields, coordinate: coordinate(`${snapshot.tap}/${name}`) });
      assets.push(resolvedAsset({ manifest: assetManifest, snapshotId: snapshot.id, commit: snapshot.commit, inventory: entries, contentDigest: inventoryDigest(entries) }));
    }
  }
  return freezeData({ assets: sortBy(assets, asset => `${asset.manifest.coordinate}:${asset.snapshotId}`),
    snapshots: sortBy(sources, snapshot => snapshot.id), selectedSnapshotIds: selected.sort() });
  });
}
async function readJson(file: string): Promise<unknown> {
  try { return JSON.parse(await readFile(file, "utf8")) as unknown; }
  catch (cause) { throw new HarnessError("INVALID_STATE", `Invalid source declaration: ${file}`, { file }, { cause }); }
}
