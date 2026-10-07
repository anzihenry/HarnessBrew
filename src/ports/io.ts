import { spawn } from "node:child_process";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm } from "node:fs/promises";
import { operationCheckpoint, operationSignal } from "../observability/operation.js";

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
/** Wait for process close on cancellation, including Git transport children on POSIX. */
async function gitBytes(command: GitCommand, maxBuffer: number): Promise<Buffer> {
  operationCheckpoint();
  const contextual = operationSignal(), signal = command.signal && contextual ? AbortSignal.any([command.signal, contextual]) : command.signal ?? contextual;
  const aborted = () => { operationCheckpoint(); const error = new Error("Git operation aborted."); error.name = "AbortError"; return error; };
  if (signal?.aborted) throw aborted();
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn("git", [...command.args], { cwd: command.cwd, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    const stdout: Buffer[] = []; let stdoutBytes = 0, stderrBytes = 0, failure: Error | undefined, killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => { try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* A process that already exited needs no signal. */ } };
    const stop = () => { kill("SIGTERM"); killTimer ??= setTimeout(() => kill("SIGKILL"), 1000); killTimer.unref(); };
    const abort = () => stop(); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) stop();
    const timer = setTimeout(() => { failure = new Error("Git command exceeded its process timeout."); stop(); }, 60000); timer.unref();
    child.stdout.on("data", (bytes: Buffer) => { stdoutBytes += bytes.length; if (stdoutBytes > maxBuffer) { failure = new Error("Git output exceeded its limit."); stop(); } else stdout.push(bytes); });
    child.stderr.on("data", (bytes: Buffer) => { stderrBytes += bytes.length; if (stderrBytes > maxBuffer) { failure = new Error("Git error output exceeded its limit."); stop(); } });
    child.once("error", error => { failure = error; });
    child.once("close", (code, exitSignal) => {
      if (signal?.aborted || failure) kill("SIGKILL");
      clearTimeout(timer); if (killTimer) clearTimeout(killTimer); signal?.removeEventListener("abort", abort);
      try {
        if (signal?.aborted) throw aborted();
        operationCheckpoint();
        if (failure) throw failure;
        if (code !== 0) throw Object.assign(new Error("Git process failed."), { code, signal: exitSignal });
        resolve(Buffer.concat(stdout));
      } catch (error) { reject(error); }
    });
  });
}
export const nodeGitClient: GitClient = {
  async run(command) { return (await gitBytes(command, 10 * 1024 * 1024)).toString("utf8").trim(); },
  async bytes(command) { return gitBytes(command, 64 * 1024 * 1024); }
};
export type StoreCheckpoint = "revision-durable" | "before-publish";
export type FaultInjector = (checkpoint: StoreCheckpoint) => void | Promise<void>;
