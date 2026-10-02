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
