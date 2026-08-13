import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { assertPathInside } from "./environment.mjs";

const execFileAsync = promisify(execFile);
const coordinatePrefix = "e2e/assets";

const kindDirectories = {
  skill: "skills",
  agent: "agents",
  workflow: "workflows",
  instruction: "instructions",
  prompt: "prompts",
  mcp: "mcp",
  adapter: "adapters"
};

async function git(cwd, environment, ...args) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      env: environment,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    return result.stdout.trim();
  } catch (error) {
    throw new Error(`Git fixture command failed in ${cwd}: git ${args.join(" ")}\n${error.stderr ?? error.message}`);
  }
}

function skillContent(name, version) {
  return [
    "---",
    `name: ${name}`,
    `description: HarnessBrew E2E ${name} ${version}`,
    "---",
    "",
    `# ${name} ${version}`,
    "",
    `Verification content for ${name} at ${version}.`,
    ""
  ].join("\n");
}

function markdownContent(name, version) {
  return `# ${name} ${version}\n\nVerification content for ${name} at ${version}.\n`;
}

async function writeFormula(repository, definition, version) {
  const kindDirectory = kindDirectories[definition.kind];
  const directory = path.join(repository, kindDirectory, definition.name);
  const entry = definition.kind === "skill" ? "SKILL.md" : definition.kind === "mcp" ? "server.json" : "content.md";
  const formula = {
    schemaVersion: 1,
    name: definition.name,
    kind: definition.kind,
    description: `HarnessBrew E2E ${definition.name} ${version}`,
    entry,
    targets: definition.targets ?? ["openai-codex", "claude-code"],
    dependencies: definition.dependencies ?? [],
    conflicts: definition.conflicts ?? [],
    tags: ["e2e", version]
  };
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "formula.json"), `${JSON.stringify(formula, null, 2)}\n`, "utf8");
  let content;
  if (definition.mcp !== undefined) content = `${JSON.stringify(definition.mcp, null, 2)}\n`;
  else content = definition.kind === "skill"
    ? skillContent(definition.name, version)
    : markdownContent(definition.name, version);
  await writeFile(path.join(directory, entry), content, "utf8");
  if (definition.kind === "skill") {
    await mkdir(path.join(directory, "references"), { recursive: true });
    await writeFile(path.join(directory, "references", "version.txt"), `${version}\n`, "utf8");
  }
}

const definitions = [
  { name: "helper-skill", kind: "skill" },
  { name: "main-skill", kind: "skill", dependencies: [`${coordinatePrefix}/helper-skill`] },
  { name: "runtime-agent", kind: "agent" },
  { name: "runtime-workflow", kind: "workflow" },
  { name: "runtime-instruction", kind: "instruction" },
  { name: "runtime-prompt", kind: "prompt" },
  {
    name: "runtime-mcp",
    kind: "mcp",
    mcp: { transport: "stdio", command: "node", args: ["runtime-mcp.mjs"], envVars: ["HARNESSBREW_RUNTIME_TOKEN"] }
  },
  {
    name: "runtime-http-mcp",
    kind: "mcp",
    mcp: {
      transport: "http",
      url: "http://127.0.0.1:43123/mcp",
      bearerTokenEnvVar: "HARNESSBREW_HTTP_TOKEN",
      headersFromEnv: { "X-E2E-Token": "HARNESSBREW_HEADER_TOKEN" }
    }
  },
  { name: "runtime-adapter", kind: "adapter" },
  { name: "conflicting-skill", kind: "skill", conflicts: [`${coordinatePrefix}/main-skill`] }
];

async function writeFixtureVersion(repository, version) {
  for (const definition of definitions) await writeFormula(repository, definition, version);
}

export async function createTapFixture(environment) {
  const root = environment.root;
  const author = assertPathInside(root, environment.paths.tapAuthor, "Tap author repository");
  const remote = assertPathInside(root, environment.paths.tapRemote, "Tap bare remote");
  await git(root, environment.environment, "init", "--bare", "--initial-branch=main", remote);
  await git(root, environment.environment, "init", "--initial-branch=main", author);
  await writeFile(path.join(author, "tap.json"), '{"schemaVersion":1}\n', "utf8");
  await writeFixtureVersion(author, "v1");
  await git(author, environment.environment, "add", ".");
  await git(author, environment.environment, "commit", "-m", "fixture: add v1 assets");
  const v1Commit = await git(author, environment.environment, "rev-parse", "HEAD");
  await git(author, environment.environment, "remote", "add", "origin", remote);
  await git(author, environment.environment, "push", "-u", "origin", "main");

  let v2Commit;
  let invalidCommit;
  return {
    name: coordinatePrefix,
    author,
    remote,
    v1Commit,
    definitions: definitions.map(({ name, kind }) => ({ name, kind, coordinate: `${coordinatePrefix}/${name}` })),
    async pushV2() {
      await git(author, environment.environment, "switch", "main");
      await writeFixtureVersion(author, "v2");
      await git(author, environment.environment, "add", ".");
      await git(author, environment.environment, "commit", "-m", "fixture: upgrade assets to v2");
      v2Commit = await git(author, environment.environment, "rev-parse", "HEAD");
      await git(author, environment.environment, "push", "origin", "main");
      return v2Commit;
    },
    async pushInvalidCandidate() {
      await git(author, environment.environment, "switch", "main");
      const directory = path.join(author, "skills", "invalid-candidate");
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "formula.json"), '{"schemaVersion":999}\n', "utf8");
      await git(author, environment.environment, "add", ".");
      await git(author, environment.environment, "commit", "-m", "fixture: add invalid candidate");
      invalidCommit = await git(author, environment.environment, "rev-parse", "HEAD");
      await git(author, environment.environment, "push", "origin", "main");
      return invalidCommit;
    },
    async repairInvalidCandidate() {
      if (invalidCommit === undefined) throw new Error("Cannot repair before an invalid candidate is pushed.");
      await rm(path.join(author, "skills", "invalid-candidate"), { recursive: true, force: false });
      await git(author, environment.environment, "add", "-A");
      await git(author, environment.environment, "commit", "-m", "fixture: remove invalid candidate");
      const repairedCommit = await git(author, environment.environment, "rev-parse", "HEAD");
      await git(author, environment.environment, "push", "origin", "main");
      return repairedCommit;
    },
    async rewriteFromV1() {
      await git(author, environment.environment, "switch", "--detach", v1Commit);
      await writeFile(path.join(author, "skills", "main-skill", "SKILL.md"), skillContent("main-skill", "rewritten"), "utf8");
      await git(author, environment.environment, "add", ".");
      await git(author, environment.environment, "commit", "-m", "fixture: rewrite main history");
      const rewrittenCommit = await git(author, environment.environment, "rev-parse", "HEAD");
      await git(author, environment.environment, "push", "--force", "origin", "HEAD:main");
      return rewrittenCommit;
    },
    get v2Commit() {
      return v2Commit;
    }
  };
}
