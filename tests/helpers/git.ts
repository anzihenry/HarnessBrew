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

export async function addFormula(
  repository: string,
  kindDirectory: string,
  name: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const directory = path.join(repository, kindDirectory, name);
  await mkdir(directory, { recursive: true });
  const kind = kindDirectory === "mcp" ? "mcp" : kindDirectory.replace(/s$/u, "");
  const defaultEntry = kind === "skill" ? "SKILL.md" : "content.md";
  const formula = {
    schemaVersion: 1,
    name,
    kind,
    description: `${name} test formula`,
    entry: defaultEntry,
    targets: ["openai-codex"],
    dependencies: [],
    tags: ["test"],
    ...overrides
  };
  await writeFile(path.join(directory, "formula.json"), `${JSON.stringify(formula, null, 2)}\n`, "utf8");
  await writeFile(path.join(directory, defaultEntry), kind === "skill"
    ? `---\nname: ${name}\ndescription: ${name} test skill\n---\n\n# ${name}\n`
    : `# ${name}\n`, "utf8");
  await git(repository, "add", kindDirectory);
  await git(repository, "commit", "-m", `add ${name}`);
  return git(repository, "rev-parse", "HEAD");
}
