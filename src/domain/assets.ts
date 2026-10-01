import { absolutePath, commitId, coordinate, digest, hash, identifier, relativePath, tapName, type CommitId, type Coordinate, type Digest } from "./identity.js";
import { array, canonicalJson, invalid, oneOf, record, text, unique } from "./validation.js";

export const assetKinds = ["skill", "agent", "workflow", "instruction", "prompt", "mcp", "adapter"] as const;
export type AssetKind = typeof assetKinds[number];
export interface AssetManifest {
  coordinate: Coordinate; kind: AssetKind; entry: string; description: string;
  dependencies: Coordinate[]; conflicts: Coordinate[]; targets: string[];
}
export type InventoryEntry = { path: string; type: "file"; digest: Digest; mode: number }
  | { path: string; type: "directory"; mode: number };
export interface SourceSnapshot {
  id: string; tap: string; url: string; commit: CommitId; treeDigest: Digest; contentLocation: string;
}
export interface ResolvedAsset {
  manifest: AssetManifest; snapshotId: string; commit: CommitId; contentDigest: Digest; inventory: InventoryEntry[];
}
export function manifest(value: unknown): AssetManifest {
  const item = record(value, "asset manifest", ["coordinate", "kind", "entry", "description", "dependencies", "conflicts", "targets"]);
  return { coordinate: coordinate(item.coordinate), kind: oneOf(item.kind, assetKinds, "asset kind"),
    entry: relativePath(item.entry), description: text(item.description, "description"),
    dependencies: [...new Set(array(item.dependencies, "dependencies", coordinate))].sort(),
    conflicts: [...new Set(array(item.conflicts, "conflicts", coordinate))].sort(),
    targets: [...new Set(array(item.targets, "targets", identifier))].sort() };
}
export function inventory(value: unknown): InventoryEntry[] {
  const entries = array(value, "inventory", raw => {
    const item = record(raw, "inventory entry", ["path", "type", "digest", "mode"]);
    const name = relativePath(item.path);
    if (!Number.isInteger(item.mode) || (item.mode as number) < 0 || (item.mode as number) > 0o777) invalid("file mode");
    if (item.type === "file") return { path: name, type: "file" as const, digest: digest(item.digest), mode: item.mode as number };
    if (item.type !== "directory" || item.digest !== undefined) invalid("inventory type");
    return { path: name, type: "directory" as const, mode: item.mode as number };
  });
  unique(entries, entry => entry.path, "inventory");
  const byPath = new Map(entries.map(entry => [entry.path, entry]));
  for (const entry of entries) {
    const parts = entry.path.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (byPath.get(parts.slice(0, i).join("/"))?.type !== "directory") invalid("inventory parent directory");
    }
  }
  return entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
export function inventoryDigest(entries: readonly InventoryEntry[]): Digest {
  return hash(canonicalJson(inventory(entries)));
}
export function sourceSnapshot(value: unknown): SourceSnapshot {
  const item = record(value, "source snapshot", ["id", "tap", "url", "commit", "treeDigest", "contentLocation"]);
  return { id: identifier(item.id), tap: tapName(item.tap), url: text(item.url, "source URL"), commit: commitId(item.commit),
    treeDigest: digest(item.treeDigest), contentLocation: absolutePath(item.contentLocation) };
}
export function resolvedAsset(value: unknown): ResolvedAsset {
  const item = record(value, "resolved asset", ["manifest", "snapshotId", "commit", "contentDigest", "inventory"]);
  const parsed = { manifest: manifest(item.manifest), snapshotId: identifier(item.snapshotId), commit: commitId(item.commit),
    contentDigest: digest(item.contentDigest), inventory: inventory(item.inventory) };
  if (!parsed.inventory.some(entry => entry.path === parsed.manifest.entry && entry.type === "file")) invalid("asset entry absent from inventory");
  if (parsed.contentDigest !== inventoryDigest(parsed.inventory)) invalid("asset inventory digest");
  return parsed;
}
