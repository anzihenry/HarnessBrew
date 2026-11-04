import { operationCheckpoint } from "../observability/operation.js";
import { emit } from "../observability/measure.js";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { inventory, inventoryDigest, type InventoryEntry } from "../domain/assets.js";
import { HarnessError } from "../domain/errors.js";
import { absolutePath, hash, relativePath, type Digest } from "../domain/identity.js";

export function sourceCheckpoint(signal?: AbortSignal): void {
  operationCheckpoint();
  if (signal?.aborted) throw new HarnessError("OPERATION_ABORTED", "Source preparation aborted.", { committed: false });
}

export async function readSourceFile(file: string, signal?: AbortSignal): Promise<Buffer> {
  sourceCheckpoint(signal);
  try {
    const bytes = await readFile(file, { signal });
    sourceCheckpoint(signal);
    return bytes;
  } catch (error) {
    sourceCheckpoint(signal);
    throw error;
  }
}

/** Does not follow links, including a substituted content root. */
export async function inspectContent(root: string, signal?: AbortSignal): Promise<{ entries: InventoryEntry[]; digest: Digest }> {
  absolutePath(root);
  const result: InventoryEntry[] = [];
  async function visit(directory: string): Promise<void> {
    sourceCheckpoint(signal);
    if (!(await lstat(directory)).isDirectory()) throw new HarnessError("CONTENT_MODIFIED", `Expected content directory: ${directory}`);
    for (const name of (await readdir(directory)).sort()) {
      sourceCheckpoint(signal);
      const file = path.join(directory, name);
      const relative = relativePath(path.relative(root, file).split(path.sep).join("/"));
      const info = await lstat(file);
      const mode = info.mode & 0o777;
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) {
        throw new HarnessError("CONTENT_MODIFIED", `Unsupported content entry: ${relative}`);
      }
      if (info.isDirectory()) {
        result.push({ path: relative, type: "directory", mode });
        await visit(file);
      } else {
        const bytes = await readSourceFile(file, signal);
        emit("inventory.files", 1, "count"); emit("inventory.bytes", bytes.length, "bytes");
        result.push({ path: relative, type: "file", digest: hash(bytes), mode });
      }
    }
  }
  await visit(root);
  sourceCheckpoint(signal);
  const entries = inventory(result);
  return { entries, digest: inventoryDigest(entries) };
}
