import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function git(repository: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync("git", args, { cwd: repository, encoding: "utf8" });
  return result.stdout.trim();
}

export async function createTapRepository(root: string): Promise<string> {
  const repository = path.join(root, "remote-tap");
  await mkdir(repository, { recursive: true });
  await git(repository, "init", "--initial-branch=main");
  await git(repository, "config", "user.name", "HarnessBrew Tests");
  await git(repository, "config", "user.email", "tests@harnessbrew.local");
  await writeFile(path.join(repository, "tap.json"), '{"schemaVersion":1}\n', "utf8");
  await git(repository, "add", "tap.json");
  await git(repository, "commit", "-m", "initial tap");
  return repository;
}

export async function commitFile(repository: string, relativePath: string, content: string): Promise<string> {
  const filePath = path.join(repository, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  await git(repository, "add", relativePath);
  await git(repository, "commit", "-m", `update ${relativePath}`);
  return git(repository, "rev-parse", "HEAD");
}
