import { lstat, realpath, rename } from "node:fs/promises";
import path from "node:path";
import { CatalogIndex } from "../domain/catalog-index.js";
import { HarnessError } from "../domain/errors.js";
import { outsideRepair } from "../domain/plan.js";
import { publishContent, stageContent } from "../execution/content.js";
import { exists, image } from "../execution/files.js";
import { catalogAssetReader } from "../ports/planning.js";
import type { PreparedContentPublisher } from "../transactions/coordinator.js";
import type { Saved } from "./saved.js";
import { cacheDirectory, ownedCacheDirectory } from "./cache.js";

/** Only host-created cache paths are eligible for consumption by a transaction. */
export async function stagePreparation(saved: Saved, cache: string): Promise<void> {
  if (!saved.plan || !saved.catalog) return;
  const catalog = new CatalogIndex(saved.catalog), reader = catalogAssetReader(saved.catalog);
  const staged = new Map<string, { digest: import("../domain/identity.js").Digest; staged: string }>();
  for (const asset of saved.plan.desiredState.assets) {
    if (outsideRepair(saved.plan, asset.coordinate) || staged.has(asset.contentDigest)) continue;
    const restoration = saved.restorations?.find(r => r.digest === asset.contentDigest);
    if (!restoration && await exists(path.join(saved.home, "content", asset.contentDigest.slice(7)))) continue;
    const source = catalog.pinned(asset);
    if (!source) continue; // Execution reports missing pinned input; release may need no source.
    const root = await cacheDirectory(cache, "prepared");
    const operation = await ownedCacheDirectory(root, saved.id, "prepared"), destination = path.join(operation, asset.contentDigest.slice(7));
    if (restoration) { await rename(restoration.staged, destination); restoration.staged = destination; }
    else await stageContent(destination, source, reader);
    staged.set(asset.contentDigest, { digest: asset.contentDigest, staged: destination });
  }
  saved.preparedContent = [...staged.values()];
  saved.resources = [...new Set([...saved.resources, ...saved.preparedContent.map(c => c.staged)])].sort();
}

export async function preparedPublisher(saved: Saved, cache: string): Promise<PreparedContentPublisher> {
  const entries = new Map((saved.preparedContent ?? []).map(c => [c.digest, c]));
  if (entries.size !== (saved.preparedContent ?? []).length) throw new HarnessError("INVALID_PLAN", "Duplicate prepared content.");
  const verify = async (entry: NonNullable<Saved["preparedContent"]>[number]) => {
    const expected = path.join(cache, "prepared", saved.id, entry.digest.slice(7));
    if (entry.staged !== expected || !saved.resources.includes(entry.staged) || !saved.plan?.desiredState.assets.some(a => a.contentDigest === entry.digest && !outsideRepair(saved.plan!, a.coordinate))) throw new HarnessError("INVALID_PLAN", "Prepared content escaped its operation cache.");
    for (const dir of [cache, path.join(cache, "prepared"), path.join(cache, "prepared", saved.id), expected]) {
      if (!(await lstat(dir)).isDirectory()) throw new HarnessError("CONTENT_MODIFIED", "Unsafe prepared content directory.");
    }
    if (await realpath(expected) !== path.join(await realpath(cache), "prepared", saved.id, entry.digest.slice(7))) throw new HarnessError("CONTENT_MODIFIED", "Prepared content identity changed.");
    const actual = await image(expected, true);
    if (actual.kind !== "content" || actual.digest !== entry.digest) throw new HarnessError("CONTENT_MODIFIED", "Prepared bytes changed; generate a new preview.");
  };
  for (const entry of entries.values()) await verify(entry);
  return { async publish(asset, destination) {
    const entry = entries.get(asset.contentDigest);
    if (!entry) return false;
    await verify(entry);
    try { await publishContent(entry.staged, destination); return true; }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code === "EXDEV") return false; throw cause; }
  } };
}
