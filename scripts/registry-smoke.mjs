import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parseNamedArguments } from "./artifact/manifest.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);

export function assertRegistryVersion(version) {
  assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u, "registry smoke requires an exact npm version");
  return version;
}

async function command(name, args, options = {}) {
  return execFileAsync(name, args, { encoding: "utf8", maxBuffer: 10 * 1024 * 1024, ...options });
}

async function installFromRegistry(version, prefix, environment) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      await command(process.platform === "win32" ? "npm.cmd" : "npm", [
        "install", "--prefix", prefix, "--ignore-scripts", `harnessbrew@${version}`
      ], { env: environment });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 6) await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
  }
  throw lastError;
}

export async function registrySmoke({ version }) {
  assertRegistryVersion(version);
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-registry-smoke-"));
  const prefix = path.join(root, "install");
  const home = path.join(root, "home");
  const author = path.join(root, "tap-author");
  const remote = path.join(root, "tap.git");
  const gitConfig = path.join(root, "gitconfig");
  const environment = {
    ...process.env,
    HARNESSBREW_HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: gitConfig
  };
  try {
    await Promise.all([mkdir(prefix, { recursive: true }), mkdir(home, { recursive: true })]);
    await writeFile(gitConfig, "[user]\n\tname = Registry Smoke\n\temail = registry@harnessbrew.invalid\n", "utf8");
    await installFromRegistry(version, prefix, environment);
    const binary = path.join(prefix, "node_modules", ".bin", process.platform === "win32" ? "harnessbrew.cmd" : "harnessbrew");
    assert.equal((await command(binary, ["--version"], { cwd: root, env: environment })).stdout.trim(), version);
    assert.match((await command(binary, ["help"], { cwd: root, env: environment })).stdout, /Git-native package manager/u);
    assert.equal((await command(process.execPath, [
      "--input-type=module", "--eval",
      'import { TARGET_ADAPTER_API_VERSION } from "harnessbrew"; console.log(TARGET_ADAPTER_API_VERSION);'
    ], { cwd: prefix, env: environment })).stdout.trim(), "1");

    await command("git", ["init", "--bare", "--initial-branch=main", remote], { cwd: root, env: environment });
    await command("git", ["init", "--initial-branch=main", author], { cwd: root, env: environment });
    const skill = path.join(author, "skills", "registry-smoke");
    await mkdir(skill, { recursive: true });
    await writeFile(path.join(author, "tap.json"), '{"schemaVersion":1}\n', "utf8");
    await writeFile(path.join(skill, "formula.json"), `${JSON.stringify({
      schemaVersion: 1,
      name: "registry-smoke",
      kind: "skill",
      description: "Registry smoke fixture.",
      entry: "SKILL.md",
      targets: ["openai-codex", "claude-code"],
      dependencies: [], conflicts: [], tags: ["smoke"]
    }, null, 2)}\n`, "utf8");
    await writeFile(path.join(skill, "SKILL.md"), "---\nname: registry-smoke\ndescription: Registry smoke fixture.\n---\n", "utf8");
    await command("git", ["add", "."], { cwd: author, env: environment });
    await command("git", ["commit", "-m", "fixture: registry smoke"], { cwd: author, env: environment });
    await command("git", ["remote", "add", "origin", remote], { cwd: author, env: environment });
    await command("git", ["push", "-u", "origin", "main"], { cwd: author, env: environment });
    await command(binary, ["tap", "add", "registry/smoke", remote, "--trust"], { cwd: root, env: environment });
    assert.match((await command(binary, ["search", "registry-smoke"], { cwd: root, env: environment })).stdout, /registry\/smoke\/registry-smoke/u);
    await command(binary, ["untap", "registry/smoke"], { cwd: root, env: environment });
    return { version };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = parseNamedArguments(process.argv.slice(2), ["--version"]);
  const version = values.get("--version");
  if (version === undefined) throw new Error("Usage: node scripts/registry-smoke.mjs --version <exact-version>");
  await registrySmoke({ version });
  console.log(`Registry smoke passed for harnessbrew@${version}.`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
