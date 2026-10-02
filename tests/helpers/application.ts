import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { TestContext } from "node:test";
import { createHarness } from "../../src/index.js";
import { git } from "./git.js";
export async function applicationFixture(t: TestContext) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "hb-app-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository"), home = path.join(root, "home"), project = path.join(root, "project"), userHome = path.join(root, "user");
  await mkdir(repository); await mkdir(project); await mkdir(userHome);
  await git(repository, "init", "--initial-branch=main"); await git(repository, "config", "user.name", "Test"); await git(repository, "config", "user.email", "test@example.com");
  await writeFile(path.join(repository, "tap.json"), JSON.stringify({ format: "harnessbrew.tap", version: 1 }));
  await git(repository, "add", "."); await git(repository, "commit", "-m", "init");
  const options = { home, cwd: project, userHome }, service = createHarness(options);
  t.after(() => service.close());
  const add = async (name: string, overrides: Record<string, unknown> = {}, content?: string) => {
    const dir = path.join(repository, "assets", name); await mkdir(dir, { recursive: true });
    const kind = overrides.kind ?? "skill", entry = kind === "skill" ? "SKILL.md" : "content.md";
    await writeFile(path.join(dir, "asset.json"), JSON.stringify({ format: "harnessbrew.asset", version: 1, kind: "skill", entry, description: name, dependencies: [], conflicts: [], targets: ["openai-codex"], ...overrides }));
    await writeFile(path.join(dir, entry), content ?? (kind === "skill" ? `---\nname: ${name}\ndescription: test\n---\n# ${name}\n` : kind === "mcp" ? '{"transport":"stdio","command":"tool","envVars":["TOKEN"]}' : `# ${name}\n`));
    await git(repository, "add", "."); await git(repository, "commit", "-m", `asset ${name}`);
  };
  const register = async () => { await service.execute({ kind: "tap.add", name: "test/assets", url: repository }); await service.execute({ kind: "tap.trust", name: "test/assets" }); };
  const placement = { target: "openai-codex", scope: "project" as const, projectRoot: project };
  return { root, repository, home, project, userHome, options, service, add, register, placement };
}
