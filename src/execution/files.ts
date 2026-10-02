import { lstat, mkdir, open, readFile, readlink, rename, rm, rmdir, symlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { HarnessError } from "../domain/errors.js";
import { inspectContent } from "../sources/inventory.js";
import type { Digest } from "../domain/identity.js";
import { canonicalJson } from "../domain/validation.js";

export type FileImage = { kind: "missing" } | { kind: "file"; bytes: string; mode: number }
  | { kind: "symlink"; target: string } | { kind: "directory"; device: string; inode: string; mode: number }
  | { kind: "content"; digest: Digest; device: string; inode: string };
export async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
export async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r"); try { await handle.sync(); } finally { await handle.close(); }
}
export async function durableFile(file: string, bytes: Uint8Array | string, mode = 0o600): Promise<void> {
  const handle = await open(file, "wx", mode);
  try { await handle.writeFile(bytes); await handle.chmod(mode); await handle.sync(); } finally { await handle.close(); }
}
export async function atomicDocument(file: string, value: unknown): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await durableFile(temporary, `${canonicalJson(value)}\n`); await rename(temporary, file); await syncDirectory(path.dirname(file)); }
  finally { await rm(temporary, { force: true }).catch(() => undefined); }
}
export async function image(file: string, content = false): Promise<FileImage> {
  try {
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) return { kind: "symlink", target: await readlink(file) };
    if (stat.isFile()) return { kind: "file", bytes: (await readFile(file)).toString("base64"), mode: stat.mode & 0o777 };
    if (stat.isDirectory()) return content ? { kind: "content", digest: (await inspectContent(file)).digest, device: String(stat.dev), inode: String(stat.ino) } : { kind: "directory", device: String(stat.dev), inode: String(stat.ino), mode: stat.mode & 0o777 };
    throw new HarnessError("RECOVERY_CONFLICT", "Unsupported resource type.", { path: file });
  } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "missing" }; throw error; }
}
export const sameImage = (left: FileImage, right: FileImage): boolean => canonicalJson(left) === canonicalJson(right);
/** The coordinator records intent first and verifies parent identity before calling this. */
export async function writeImage(file: string, next: FileImage, temporary: string): Promise<void> {
  if (next.kind === "missing") {
    await rm(file, { force: true }); await syncDirectory(path.dirname(file)); return;
  }
  if (next.kind === "directory") {
    await mkdir(file, { mode: 0o755 }); await syncDirectory(path.dirname(file)); return;
  }
  if (next.kind === "content") throw new HarnessError("INVALID_ARGUMENT", "Content publication requires a verified staging directory.");
  let created = false;
  try {
    if (next.kind === "file") {
      const handle = await open(temporary, "wx", next.mode); created = true;
      try { await handle.writeFile(Buffer.from(next.bytes, "base64")); await handle.chmod(next.mode); await handle.sync(); } finally { await handle.close(); }
    } else { await symlink(next.target, temporary); created = true; }
    await rename(temporary, file); await syncDirectory(path.dirname(file));
  } finally { if (created) await rm(temporary, { force: true }).catch(() => undefined); }
}
export async function removeDirectory(file: string): Promise<void> { await rmdir(file); await syncDirectory(path.dirname(file)); }
