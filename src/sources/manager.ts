import { operationCheckpoint, operationSignal } from "../observability/operation.js";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sourceSnapshot, type SourceSnapshot } from "../domain/assets.js";
import { HarnessError } from "../domain/errors.js";
import { absolutePath, commitId, relativePath, stableId, tapName, type CommitId } from "../domain/identity.js";
import { canonicalJson, format, text } from "../domain/validation.js";
import { nodeGitClient, type GitClient, type GitCommand } from "../ports/io.js";
import { withFileLock } from "../transactions/file-lock.js";
import { inspectContent } from "./inventory.js";

export interface SourceRequest {
  name: string;
  url: string;
  ref?: string;
  commit?: CommitId;
  previous?: SourceSnapshot;
  allowRewind?: boolean;
  signal?: AbortSignal;
}
interface TreeFile { name: string; object: string; mode: number }
async function exists(file: string): Promise<boolean> {
  try { await lstat(file); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function directory(file: string): Promise<void> {
  if (!(await lstat(file)).isDirectory()) throw new HarnessError("CONTENT_MODIFIED", `Unsafe cache directory: ${file}`);
}

/** Prepares Git data in an explicitly supplied cache. Never opens a StateStore or writes Agent targets. */
export class SourceManager {
  constructor(private readonly cacheRoot: string, private readonly git: GitClient = nodeGitClient) {
    absolutePath(cacheRoot);
  }
  private async command(args: readonly string[], cwd: string, signal?: AbortSignal): Promise<string> {
    operationCheckpoint();
    try { const result = await this.git.run({ args: ["-c", "protocol.ext.allow=never", ...args], cwd, ...(signal ? { signal } : {}) }); operationCheckpoint(); return result; }
    catch (cause) {
      operationCheckpoint();
      if (signal?.aborted) throw cause;
      throw new HarnessError("GIT_FAILED", "Git source operation failed.", { operation: args[0] }, { cause });
    }
  }
  private async bytes(command: GitCommand): Promise<Uint8Array> {
    operationCheckpoint();
    try { const result = await this.git.bytes(command); operationCheckpoint(); return result; }
    catch (cause) {
      operationCheckpoint();
      if (command.signal?.aborted) throw cause;
      throw new HarnessError("GIT_FAILED", "Could not read Git source objects.", { operation: command.args[0] }, { cause });
    }
  }
  async prepare(input: SourceRequest): Promise<SourceSnapshot> {
    return (await this.prepareSelection(input)).snapshot;
  }
  /** Resolve tracking policy independently from immutable snapshot identity. */
  async prepareSelection(input: SourceRequest): Promise<{ snapshot: SourceSnapshot; ref?: string }> {
    operationCheckpoint();
    const contextSignal = operationSignal();
    if (contextSignal) input = { ...input, signal: input.signal ? AbortSignal.any([input.signal, contextSignal]) : contextSignal };
    const request = structuredClone({ ...input, signal: undefined });
    const name = tapName(request.name);
    const url = text(request.url, "source URL");
    if (request.ref !== undefined) text(request.ref, "Git ref");
    if (request.allowRewind !== undefined && typeof request.allowRewind !== "boolean") throw new HarnessError("INVALID_ARGUMENT", "allowRewind must be a boolean.");
    if (url.startsWith("-") || request.ref?.startsWith("-") || /[\0\r\n]/u.test(url)) {
      throw new HarnessError("INVALID_ARGUMENT", "Invalid Git source URL or ref.");
    }
    if (request.commit && request.ref) throw new HarnessError("INVALID_ARGUMENT", "Choose a ref or an exact commit, not both.");
    const locked = request.commit === undefined ? undefined : commitId(request.commit);
    const previous = request.previous === undefined ? undefined : sourceSnapshot(request.previous);
    if (previous && (previous.tap !== name || previous.url !== url)) throw new HarnessError("SOURCE_MISMATCH", "Previous snapshot belongs to another source.");
    await mkdir(this.cacheRoot, { recursive: true });
    await directory(this.cacheRoot);
    const root = await realpath(this.cacheRoot);
    const sourceId = stableId({ name, url });
    for (const part of ["repositories", "snapshots", "locks"]) {
      const target = path.join(root, part);
      await mkdir(target, { recursive: true });
      await directory(target);
    }
    return withFileLock(path.join(root, "locks", `${sourceId}.lock`), async () => {
      const repository = path.join(root, "repositories", sourceId);
      if (!await exists(repository)) {
        const temporary = `${repository}.${randomUUID()}.tmp`;
        try {
          await this.command(["clone", "--bare", "--no-local", "--", url, temporary], root, input.signal);
          await rename(temporary, repository);
        } finally { await rm(temporary, { recursive: true, force: true }); }
      }
      await directory(repository);
      // No checkout, hook, smudge filter, submodule update, or code from the Tap is executed.
      await this.command(["fetch", "--quiet", "--force", "--prune", "origin", "+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*"], repository, input.signal);
      const algorithm = await this.command(["rev-parse", "--show-object-format"], repository, input.signal);
      if (previous && previous.commit.algorithm !== algorithm) throw new HarnessError("SOURCE_MISMATCH", "Previous snapshot uses another Git object format.");
      let revision: string;
      let trackingRef: string | undefined;
      if (locked) {
        if (algorithm !== locked.algorithm) throw new HarnessError("SOURCE_MISMATCH", "Git object format differs from the lock.");
        try { revision = await this.command(["rev-parse", "--verify", `${locked.value}^{commit}`], repository, input.signal); }
        catch (error) {
          operationCheckpoint();
          if (input.signal?.aborted) throw error;
          await this.command(["fetch", "--quiet", "origin", locked.value], repository, input.signal);
          revision = await this.command(["rev-parse", "--verify", `${locked.value}^{commit}`], repository, input.signal);
        }
      } else {
        let ref = request.ref;
        if (ref === undefined) {
          const output = await this.command(["ls-remote", "--symref", "origin", "HEAD"], repository, input.signal);
          ref = /^ref: (refs\/heads\/[^\t\n]+)\tHEAD$/mu.exec(output)?.[1];
          if (!ref) throw new HarnessError("SOURCE_NOT_FOUND", "Remote HEAD does not identify a branch.");
        }
        const choices = ref.startsWith("refs/heads/") || ref.startsWith("refs/tags/") ? [ref] : [`refs/heads/${ref}`, `refs/tags/${ref}`];
        for (const choice of choices) {
          try { await this.command(["check-ref-format", choice], repository, input.signal); }
          catch (cause) { operationCheckpoint(); if (input.signal?.aborted) throw cause; throw new HarnessError("INVALID_ARGUMENT", "Expected a literal Git branch or tag.", {}, { cause }); }
        }
        const found: { ref: string; revision: string }[] = [];
        for (const choice of choices) {
          try { found.push({ ref: choice, revision: await this.command(["rev-parse", "--verify", `${choice}^{commit}`], repository, input.signal) }); }
          catch (error) { operationCheckpoint(); if (input.signal?.aborted) throw error; }
        }
        if (!found.length) throw new HarnessError("SOURCE_NOT_FOUND", `Git ref not found: ${ref}`);
        if (new Set(found.map(value => value.revision)).size > 1) throw new HarnessError("INVALID_ARGUMENT", "Git ref is ambiguous; use refs/heads/ or refs/tags/.", { ref });
        revision = found[0]!.revision;
        if (request.ref !== undefined) trackingRef = found[0]!.ref;
      }
      const commit = commitId({ algorithm, value: revision });
      if (!locked && previous && previous.commit.value !== commit.value && !request.allowRewind) {
        try {
          await this.git.run({ args: ["merge-base", "--is-ancestor", previous.commit.value, commit.value], cwd: repository, ...(input.signal ? { signal: input.signal } : {}) });
        } catch (cause) {
          operationCheckpoint();
          if (input.signal?.aborted) throw cause;
          if ((cause as { code?: number }).code === 1) throw new HarnessError("SOURCE_REWIND", "Source update is not a fast-forward.", { before: previous.commit, after: commit });
          throw new HarnessError("GIT_FAILED", "Could not verify source continuity.", {}, { cause });
        }
      }
      const id = stableId({ tap: name, url, commit });
      const destination = path.join(root, "snapshots", id);
      const files = await this.tree(repository, commit, input.signal);
      if (await exists(destination)) {
        await directory(destination);
        const snapshot = await this.readMetadata(destination);
        if (snapshot.id !== id || snapshot.tap !== name || snapshot.url !== url || canonicalJson(snapshot.commit) !== canonicalJson(commit)
          || snapshot.contentLocation !== path.join(destination, "content")) throw new HarnessError("CONTENT_MODIFIED", "Cached snapshot identity changed.");
        await this.verifyTree(snapshot, files);
        return { snapshot, ...(trackingRef ? { ref: trackingRef } : {}) };
      }
      const temporary = `${destination}.${randomUUID()}.tmp`;
      const content = path.join(temporary, "content");
      try {
        await mkdir(content, { recursive: true });
        for (const file of files) {
          const output = path.join(content, file.name);
          await mkdir(path.dirname(output), { recursive: true, mode: 0o755 });
          const bytes = await this.bytes({ args: ["cat-file", "blob", file.object], cwd: repository, ...(input.signal ? { signal: input.signal } : {}) });
          await writeFile(output, bytes, { flag: "wx", mode: file.mode });
          await chmod(output, file.mode);
        }
        const inventory = await inspectContent(content);
        // Explicit directory permissions make the digest independent of the caller's umask.
        for (const entry of inventory.entries.filter(entry => entry.type === "directory")) await chmod(path.join(content, entry.path), 0o755);
        const treeDigest = (await inspectContent(content)).digest;
        const snapshot: SourceSnapshot = { id, tap: name, url, commit, treeDigest, contentLocation: path.join(destination, "content") };
        await this.verifyTree({ ...snapshot, contentLocation: content }, files);
        await writeFile(path.join(temporary, "snapshot.json"), `${canonicalJson({ format: "harnessbrew.source-snapshot", version: 1, snapshot })}\n`, { flag: "wx" });
        await rename(temporary, destination);
        return { snapshot, ...(trackingRef ? { ref: trackingRef } : {}) };
      } finally { await rm(temporary, { recursive: true, force: true }); }
    }, input.signal ? { signal: input.signal } : {});
  }
  private async readMetadata(directoryPath: string): Promise<SourceSnapshot> {
    const file = path.join(directoryPath, "snapshot.json");
    if (!(await lstat(file)).isFile()) throw new HarnessError("CONTENT_MODIFIED", "Invalid snapshot metadata file.");
    try {
      const item = format(JSON.parse(await readFile(file, "utf8")), "harnessbrew.source-snapshot", ["snapshot"]);
      return sourceSnapshot(item.snapshot);
    } catch (cause) { throw new HarnessError("CONTENT_MODIFIED", "Invalid snapshot metadata.", {}, { cause }); }
  }
  private async tree(repository: string, commit: CommitId, signal?: AbortSignal): Promise<TreeFile[]> {
    const command: GitCommand = { args: ["ls-tree", "-rz", "--full-tree", commit.value], cwd: repository, ...(signal ? { signal } : {}) };
    const output = new TextDecoder("utf-8", { fatal: true }).decode(await this.bytes(command));
    return output.split("\0").filter(Boolean).map(line => {
      const match = /^(100644|100755) blob ([0-9a-f]+)\t([\s\S]+)$/u.exec(line);
      if (!match) throw new HarnessError("CONTENT_MODIFIED", "Source contains a symlink, submodule, or unsupported Git entry.");
      const name = relativePath(match[3]);
      if (name.split("/").some(part => part.toLowerCase() === ".git")) throw new HarnessError("CONTENT_MODIFIED", "Reserved source path.");
      return { name, object: match[2]!, mode: match[1] === "100755" ? 0o755 : 0o644 };
    }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  }
  private async verifyTree(snapshot: SourceSnapshot, files: TreeFile[]): Promise<void> {
    const actual = await inspectContent(snapshot.contentLocation);
    if (actual.digest !== snapshot.treeDigest) throw new HarnessError("CONTENT_MODIFIED", "Cached source content changed.");
    const entries = actual.entries.filter(entry => entry.type === "file");
    if (entries.length !== files.length) throw new HarnessError("CONTENT_MODIFIED", "Cached source inventory differs from Git.");
    for (const file of files) {
      const entry = entries.find(entry => entry.path === file.name);
      const bytes = await readFile(path.join(snapshot.contentLocation, file.name));
      const object = createHash(snapshot.commit.algorithm).update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
      if (!entry || entry.mode !== file.mode || object !== file.object) throw new HarnessError("CONTENT_MODIFIED", `Cached source differs from Git: ${file.name}`);
    }
    const expectedDirectories = new Set(files.flatMap(file => file.name.split("/").slice(0, -1).map((_, index) => file.name.split("/").slice(0, index + 1).join("/"))));
    const directories = actual.entries.filter(entry => entry.type === "directory");
    if (directories.length !== expectedDirectories.size || directories.some(entry => entry.mode !== 0o755 || !expectedDirectories.has(entry.path))) {
      throw new HarnessError("CONTENT_MODIFIED", "Cached source directories differ from Git.");
    }
  }
}
