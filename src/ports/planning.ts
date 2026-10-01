import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import type { AssetReader } from "../domain/adapter.js";
import type { CatalogSnapshot } from "../domain/catalog.js";
import type { PathIdentity, PlanningIO, TargetSnapshot } from "../domain/plan.js";
import { HarnessError } from "../domain/errors.js";
import { absolutePath, contained, relativePath } from "../domain/identity.js";

async function identify(input: string): Promise<PathIdentity> {
  const target = absolutePath(input);
  let ancestor = path.dirname(target);
  for (;;) {
    try {
      const real = await realpath(ancestor);
      const info = await lstat(real, { bigint: true });
      if (!info.isDirectory()) throw new HarnessError("INVALID_PLAN", "A target parent is not a directory.");
      return { physicalPath: path.join(real, path.relative(ancestor, target)), ancestor: { path: ancestor, realPath: real, device: String(info.dev), inode: String(info.ino) } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      try {
        if ((await lstat(ancestor)).isSymbolicLink()) throw new HarnessError("INVALID_PLAN", "A target parent is a dangling symbolic link.");
      } catch (inspection) { if ((inspection as NodeJS.ErrnoException).code !== "ENOENT") throw inspection; }
      if (ancestor === path.parse(ancestor).root) throw error;
      ancestor = path.dirname(ancestor);
    }
  }
}
export const nodePlanningIO: PlanningIO = {
  identify,
  async inspect(input) {
    const destination = absolutePath(input), identity = await identify(destination);
    try {
      const info = await lstat(destination);
      if (info.isSymbolicLink()) return { path: destination, identity, kind: "symlink", target: path.resolve(path.dirname(destination), await readlink(destination)) };
      if (info.isDirectory()) return { path: destination, identity, kind: "directory" };
      if (!info.isFile()) return { path: destination, identity, kind: "other" };
      const bytes = await readFile(destination);
      let content: string;
      try { content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch (cause) { throw new HarnessError("TARGET_MODIFIED", "Target file is not valid UTF-8.", { path: destination }, { cause }); }
      return { path: destination, identity, kind: "file", content, mode: info.mode & 0o777 };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { path: destination, identity, kind: "missing" };
      throw error;
    }
  }
};
/** Read-only content access; the AssetView additionally checks the pinned byte digest. */
export function catalogAssetReader(catalog: CatalogSnapshot): AssetReader {
  const sources = new Map(catalog.snapshots.map(snapshot => [snapshot.id, snapshot]));
  return { async readAsset(asset, name) {
    const snapshot = sources.get(asset.snapshotId);
    if (!snapshot) throw new HarnessError("SOURCE_NOT_FOUND", "Asset snapshot is unavailable.");
    const root = path.join(snapshot.contentLocation, "assets", asset.manifest.coordinate.split("/")[2]!);
    const destination = path.join(root, relativePath(name));
    let component = snapshot.contentLocation;
    for (const segment of ["assets", asset.manifest.coordinate.split("/")[2]!, ...relativePath(name).split("/")]) {
      component = path.join(component, segment);
      if ((await lstat(component)).isSymbolicLink()) throw new HarnessError("CONTENT_MODIFIED", "Asset inventory cannot contain symbolic links.");
    }
    const entry = asset.inventory.find(item => item.path === name);
    const info = await lstat(destination);
    if (!entry || entry.type !== "file" || !info.isFile() || (info.mode & 0o777) !== entry.mode) throw new HarnessError("CONTENT_MODIFIED", "Asset inventory mode or type changed.");
    const physicalRoot = await realpath(root), physical = await realpath(destination);
    if (!contained(physicalRoot, physical, false) || (await lstat(destination)).isSymbolicLink()) throw new HarnessError("CONTENT_MODIFIED", "Asset path escaped its inventory root.");
    return readFile(destination);
  } };
}
