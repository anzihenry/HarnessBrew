import { chmod, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { AssetReader } from "../domain/adapter.js";
import type { ResolvedAsset } from "../domain/assets.js";
import { HarnessError } from "../domain/errors.js";
import { hash } from "../domain/identity.js";
import { inspectContent } from "../sources/inventory.js";
import { durableFile, exists, syncDirectory } from "./files.js";

/** Builds only in an isolated transaction cache; publication is journaled by the coordinator. */
export async function stageContent(directory: string, asset: ResolvedAsset, reader: AssetReader): Promise<void> {
  if (await exists(directory)) throw new HarnessError("RECOVERY_REQUIRED", "Staging directory already exists.");
  await mkdir(directory, { mode: 0o755 });
  try {
    for (const item of asset.inventory.filter(item => item.type === "directory").sort((a, b) => a.path.split("/").length - b.path.split("/").length)) await mkdir(path.join(directory, item.path), { mode: 0o755 });
    for (const item of asset.inventory) if (item.type === "file") {
      const bytes = await reader.readAsset(asset, item.path);
      if (hash(bytes) !== item.digest) throw new HarnessError("CONTENT_MODIFIED", "Source bytes differ from the pinned inventory.", { asset: asset.manifest.coordinate, path: item.path });
      await durableFile(path.join(directory, item.path), bytes, item.mode);
    }
    for (const item of asset.inventory.filter(item => item.type === "directory").sort((a, b) => b.path.split("/").length - a.path.split("/").length)) {
      await chmod(path.join(directory, item.path), item.mode); await syncDirectory(path.join(directory, item.path));
    }
    await syncDirectory(directory);
    if ((await inspectContent(directory)).digest !== asset.contentDigest) throw new HarnessError("CONTENT_MODIFIED", "Staged content differs from inventory.");
  } catch (error) { await rm(directory, { recursive: true, force: true }).catch(() => undefined); throw error; }
}
export async function publishContent(staging: string, destination: string): Promise<void> {
  await rename(staging, destination); await syncDirectory(path.dirname(destination));
  if (path.dirname(staging) !== path.dirname(destination)) await syncDirectory(path.dirname(staging));
}
