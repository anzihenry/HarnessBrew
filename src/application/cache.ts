import { atomicDocument } from "../execution/files.js";
import { hash } from "../domain/identity.js";
import { canonicalJson } from "../domain/validation.js";
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { HarnessError } from "../domain/errors.js";
/** Cache subdirectories are host-owned directories, never symlink redirects. */
export async function cacheDirectory(root: string, child: string): Promise<string> {
  for (const directory of [root, path.join(root, child)]) {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (!(await lstat(directory)).isDirectory()) throw new HarnessError("INVALID_STATE", "Unsafe application cache directory.", { directory });
  }
  return path.join(root, child);
}

/** Explicit producer receipt; legacy/unmarked directories are never inferred to be disposable. */
export async function ownedCacheDirectory(root: string, id: string, purpose: "prepared" | "restore"): Promise<string> {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(id)) throw new HarnessError("INVALID_ARGUMENT", "Invalid cache owner ID.");
  const directory = await cacheDirectory(root, id);
  const value = { format: "harnessbrew.cache-owner", version: 1, id, purpose };
  await atomicDocument(path.join(directory, ".owner.json"), { value, digest: hash(canonicalJson(value)) });
  return directory;
}
