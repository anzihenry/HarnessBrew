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
  await assertDestinationAvailable(destination);
  const directories = await createdParents(destination);
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

    throw new HarnessBrewError(`Transaction operation is not implemented yet: ${input.type}`);
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
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
    throw new Error("operation verifier not implemented");
  } catch {
    throw new HarnessBrewError(`Installed target was modified: ${operation.destination}`);
  }
}

export async function removeTargetOperation(operation: InstalledOperation, force = false): Promise<void> {
  if (!force) await verifyTargetOperation(operation);
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
