import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { HarnessBrewError } from "./errors.js";

const execFileAsync = promisify(execFile);

export async function runGit(args: readonly string[], cwd?: string): Promise<string> {
  try {
    const result = await execFileAsync("git", [...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    return result.stdout.trim();
  } catch (error) {
    const failure = error as Error & { stderr?: string };
    const detail = failure.stderr?.trim() || failure.message;
    throw new HarnessBrewError(`Git command failed: ${detail}`);
  }
}

export async function resolveGitCommit(repositoryPath: string, ref?: string): Promise<string> {
  if (ref === undefined) {
    const symbolic = await runGit(["symbolic-ref", "refs/remotes/origin/HEAD"], repositoryPath);
    return runGit(["rev-parse", "--verify", `${symbolic}^{commit}`], repositoryPath);
  }

  const candidates = [`refs/remotes/origin/${ref}`, `refs/tags/${ref}`, ref];
  for (const candidate of candidates) {
    try {
      return await runGit(["rev-parse", "--verify", `${candidate}^{commit}`], repositoryPath);
    } catch {
      // Try the next unambiguous Git ref form.
    }
  }

  throw new HarnessBrewError(`Git ref not found: ${ref}`);
}

export async function isGitAncestor(repositoryPath: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["merge-base", "--is-ancestor", ancestor, descendant], {
      cwd: repositoryPath,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    return true;
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 1) return false;
    const failure = error as Error & { stderr?: string };
    throw new HarnessBrewError(`Git command failed: ${failure.stderr?.trim() || failure.message}`);
  }
}
