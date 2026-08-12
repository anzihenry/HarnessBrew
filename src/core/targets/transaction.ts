import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readlink, rename, rm, rmdir, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { HarnessBrewError } from "../errors.js";
import type { InstalledOperation, InstalledOperationType } from "../installations.js";

export interface TargetOperationInput {
  id: string;
  type: InstalledOperationType;
  target: string;
  destination: string;
  source?: string;
  content?: string;
  ownedKeys?: string[];
  marker?: string;
}

async function pathMetadata(filePath: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function digestFile(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

function digestContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function managedBlock(marker: string, content: string): string {
  if (marker.trim() === "" || marker.includes("\n") || marker.includes("-->")) {
    throw new HarnessBrewError(`Invalid managed-block marker: ${marker}`);
  }
  return `<!-- harnessbrew:start ${marker} -->\n${content.trimEnd()}\n<!-- harnessbrew:end ${marker} -->`;
}

function locateManagedBlock(content: string, marker: string): { start: number; end: number; block: string } | undefined {
  const startMarker = `<!-- harnessbrew:start ${marker} -->`;
  const endMarker = `<!-- harnessbrew:end ${marker} -->`;
  const start = content.indexOf(startMarker);
  if (start === -1) return undefined;
  const endMarkerStart = content.indexOf(endMarker, start + startMarker.length);
  if (endMarkerStart === -1 || content.indexOf(startMarker, start + startMarker.length) !== -1) return undefined;
  const end = endMarkerStart + endMarker.length;
  return { start, end, block: content.slice(start, end) };
}

async function createdParents(destination: string): Promise<string[]> {
  const created: string[] = [];
  let current = path.dirname(destination);
  while (await pathMetadata(current) === undefined) {
    created.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  return created;
}

async function cleanupParents(operation: InstalledOperation): Promise<void> {
  for (const directory of operation.createdDirectories) {
    try {
      await rmdir(directory);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
    }
  }
}

async function assertDestinationAvailable(destination: string): Promise<void> {
  if (await pathMetadata(destination) !== undefined) {
    throw new HarnessBrewError(`Target path already exists: ${destination}`);
  }
}

async function applyOperation(input: TargetOperationInput): Promise<InstalledOperation> {
  const destination = path.resolve(input.destination);
  if (input.type !== "managed-block") await assertDestinationAvailable(destination);
  const directories = await createdParents(destination);
  let managedDestinationExisted = false;
  let managedBefore: string | undefined;
  try {
    if (input.type === "symlink-file" || input.type === "symlink-directory") {
      if (input.source === undefined) throw new HarnessBrewError(`Missing source for ${input.type}: ${input.id}`);
      const source = path.resolve(input.source);
      const metadata = await stat(source);
      if (input.type === "symlink-file" && !metadata.isFile()) {
        throw new HarnessBrewError(`Symlink source is not a file: ${source}`);
      }
      if (input.type === "symlink-directory" && !metadata.isDirectory()) {
        throw new HarnessBrewError(`Symlink source is not a directory: ${source}`);
      }
      await symlink(source, destination, input.type === "symlink-directory" ? "dir" : "file");
      return {
        id: input.id,
        type: input.type,
        target: input.target,
        destination,
        source,
        ...(input.type === "symlink-file" ? { installedDigest: await digestFile(source) } : {}),
        createdDirectories: directories
      };
    }

    if (input.type === "render-file") {
      if (input.content === undefined) throw new HarnessBrewError(`Missing content for render-file: ${input.id}`);
      const temporaryPath = `${destination}.${process.pid}.tmp`;
      await writeFile(temporaryPath, input.content, "utf8");
      await rename(temporaryPath, destination);
      return {
        id: input.id,
        type: input.type,
        target: input.target,
        destination,
        installedDigest: await digestFile(destination),
        createdDirectories: directories
      };
    }

    if (input.type === "managed-block") {
      if (input.content === undefined || input.marker === undefined) {
        throw new HarnessBrewError(`Missing content or marker for managed-block: ${input.id}`);
      }
      const metadata = await pathMetadata(destination);
      managedDestinationExisted = metadata !== undefined;
      if (metadata !== undefined && !metadata.isFile()) {
        throw new HarnessBrewError(`Managed-block destination is not a regular file: ${destination}`);
      }
      const before = metadata === undefined ? "" : await readFile(destination, "utf8");
      managedBefore = before;
      if (locateManagedBlock(before, input.marker) !== undefined) {
        throw new HarnessBrewError(`Managed block already exists: ${input.marker}`);
      }
      const block = managedBlock(input.marker, input.content);
      const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
      const temporaryPath = `${destination}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${before}${prefix}${block}\n`, "utf8");
      await rename(temporaryPath, destination);
      return {
        id: input.id,
        type: input.type,
        target: input.target,
        destination,
        ...(metadata === undefined ? {} : { beforeDigest: digestContent(before) }),
        installedDigest: digestContent(block),
        marker: input.marker,
        managedPrefix: prefix,
        createdDirectories: directories
      };
    }

    throw new HarnessBrewError(`Transaction operation is not implemented yet: ${input.type}`);
  } catch (error) {
    await rm(`${destination}.${process.pid}.tmp`, { force: true });
    if (input.type === "managed-block" && managedDestinationExisted) {
      if (managedBefore !== undefined) await writeFile(destination, managedBefore, "utf8");
    } else {
      await rm(destination, { recursive: true, force: true });
    }
    await cleanupParents({
      id: input.id,
      type: input.type,
      target: input.target,
      destination,
      createdDirectories: directories
    });
    throw error;
  }
}

export async function verifyTargetOperation(operation: InstalledOperation): Promise<void> {
  try {
    if (operation.type === "symlink-file" || operation.type === "symlink-directory") {
      if (operation.source === undefined) throw new Error("missing source");
      const metadata = await lstat(operation.destination);
      if (!metadata.isSymbolicLink()) throw new Error("not a symbolic link");
      const target = path.resolve(path.dirname(operation.destination), await readlink(operation.destination));
      if (target !== operation.source) throw new Error("link target changed");
      if (operation.installedDigest !== undefined && await digestFile(operation.source) !== operation.installedDigest) {
        throw new Error("source changed");
      }
      return;
    }
    if (operation.type === "render-file") {
      if (operation.installedDigest === undefined || await digestFile(operation.destination) !== operation.installedDigest) {
        throw new Error("rendered file changed");
      }
      return;
    }
    if (operation.type === "managed-block") {
      if (operation.marker === undefined || operation.installedDigest === undefined) throw new Error("missing marker");
      const located = locateManagedBlock(await readFile(operation.destination, "utf8"), operation.marker);
      if (located === undefined || digestContent(located.block) !== operation.installedDigest) {
        throw new Error("managed block changed");
      }
      return;
    }
    throw new Error("operation verifier not implemented");
  } catch {
    throw new HarnessBrewError(`Installed target was modified: ${operation.destination}`);
  }
}

export async function removeTargetOperation(operation: InstalledOperation, force = false): Promise<void> {
  if (!force) await verifyTargetOperation(operation);
  if (operation.type === "managed-block") {
    if (operation.marker === undefined) {
      if (force) return;
      throw new HarnessBrewError(`Installed target was modified: ${operation.destination}`);
    }
    const current = await readFile(operation.destination, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (force && error.code === "ENOENT") return undefined;
      throw error;
    });
    if (current === undefined) return;
    const located = locateManagedBlock(current, operation.marker);
    if (located === undefined) {
      if (force) return;
      throw new HarnessBrewError(`Installed target was modified: ${operation.destination}`);
    }
    const trailingEnd = current[located.end] === "\n" ? located.end + 1 : located.end;
    const prefix = operation.managedPrefix ?? "";
    const prefixStart = located.start >= prefix.length
      && current.slice(located.start - prefix.length, located.start) === prefix
      ? located.start - prefix.length
      : located.start;
    const remaining = `${current.slice(0, prefixStart)}${current.slice(trailingEnd)}`;
    if (operation.beforeDigest === undefined && remaining === "") {
      await rm(operation.destination, { force: true });
    } else {
      const temporaryPath = `${operation.destination}.${process.pid}.tmp`;
      await writeFile(temporaryPath, remaining, "utf8");
      await rename(temporaryPath, operation.destination);
    }
    await cleanupParents(operation);
    return;
  }
  await rm(operation.destination, { recursive: operation.type === "symlink-directory", force: true });
  await cleanupParents(operation);
}

export async function executeTargetOperations(inputs: readonly TargetOperationInput[]): Promise<InstalledOperation[]> {
  const installed: InstalledOperation[] = [];
  try {
    for (const input of inputs) installed.push(await applyOperation(input));
    return installed;
  } catch (error) {
    for (const operation of installed.reverse()) await removeTargetOperation(operation, true);
    throw error;
  }
}
