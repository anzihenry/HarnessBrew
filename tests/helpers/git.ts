import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function git(repository: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd: repository, encoding: "utf8" });
  return result.stdout.trim();
}

export async function commitFile(repository: string, relativePath: string, content: string): Promise<string> {
  const filePath = path.join(repository, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  await git(repository, "add", relativePath);
  await git(repository, "commit", "-m", `update ${relativePath}`);
  return git(repository, "rev-parse", "HEAD");
}
