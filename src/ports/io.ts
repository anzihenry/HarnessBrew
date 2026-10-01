import { execFile } from "node:child_process";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import { promisify } from "node:util";

/** Narrow storage boundary: test implementations can inject I/O failures without patching globals. */
export interface StorageIO {
  read(path: string): Promise<string>;
  realpath(path: string): Promise<string>;
  list(path: string): Promise<string[]>;
  kind(path: string): Promise<"file" | "directory" | "symlink" | "other" | "missing">;
  mkdir(path: string): Promise<void>;
  writeExclusive(path: string, content: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  remove(path: string): Promise<void>;
  syncDirectory(path: string): Promise<void>;
}
export const nodeStorageIO: StorageIO = {
  read: file => readFile(file, "utf8"),
  realpath,
  list: directory => readdir(directory),
  async kind(file) {
    try {
      const info = await lstat(file);
      return info.isSymbolicLink() ? "symlink" : info.isFile() ? "file" : info.isDirectory() ? "directory" : "other";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
      throw error;
    }
  },
  async mkdir(directory) { await mkdir(directory, { recursive: true }); },
  async writeExclusive(file, content) {
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(content, "utf8"); await handle.sync(); }
    finally { await handle.close(); }
  },
  rename,
  async remove(file) { await rm(file, { recursive: true, force: true }); },
  async syncDirectory(directory) {
    const handle = await open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
  }
};

export interface GitCommand {
  args: readonly string[];
  cwd: string;
  signal?: AbortSignal;
}
export interface GitClient {
  run(command: GitCommand): Promise<string>;
  bytes(command: GitCommand): Promise<Uint8Array>;
}
const execFileAsync = promisify(execFile);
export const nodeGitClient: GitClient = {
  async run({ args, cwd, signal }) {
    const result = await execFileAsync("git", [...args], {
      cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024, timeout: 60_000,
      ...(signal === undefined ? {} : { signal })
    });
    return result.stdout.trim();
  },
  async bytes({ args, cwd, signal }) {
    const result = await execFileAsync("git", [...args], {
      cwd, encoding: "buffer", maxBuffer: 64 * 1024 * 1024, timeout: 60_000,
      ...(signal === undefined ? {} : { signal })
    });
    return result.stdout;
  }
};
export type StoreCheckpoint = "revision-durable" | "before-publish";
export type FaultInjector = (checkpoint: StoreCheckpoint) => void | Promise<void>;
