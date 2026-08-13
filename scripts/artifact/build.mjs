import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parseNamedArguments, sha256File } from "./manifest.mjs";
import { verifyArtifact } from "./verify.mjs";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "../..");

async function command(commandName, args, options = {}) {
  return execFileAsync(commandName, args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...options
  });
}

export async function buildArtifact({ outputDirectory, allowDirty = false }) {
  const output = path.resolve(outputDirectory);
  await mkdir(output, { recursive: true });
  const existingArtifacts = (await readdir(output)).filter((entry) => entry.endsWith(".tgz")
    || entry === "artifact-manifest.json" || entry === "SHA256SUMS");
  if (existingArtifacts.length > 0) {
    throw new Error(`Artifact output directory already contains release files: ${existingArtifacts.join(", ")}`);
  }

  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  const status = (await command("git", ["status", "--porcelain", "--untracked-files=all"])).stdout.trim();
  const dirty = status !== "";
  if (dirty && !allowDirty) {
    throw new Error("Release artifacts require a clean Git worktree. Use --allow-dirty only for local development tests.");
  }
  const commit = (await command("git", ["rev-parse", "HEAD"])).stdout.trim();
  assert.match(commit, /^[a-f0-9]{40}$/u, "Git commit must be a full SHA-1 digest");
  const npmVersion = (await command(process.platform === "win32" ? "npm.cmd" : "npm", ["--version"])).stdout.trim();

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const packResult = await command(npmCommand, [
    "pack",
    "--json",
    "--pack-destination",
    output,
    "--cache",
    path.join(projectRoot, ".npm-cache")
  ]);
  const packEntries = JSON.parse(packResult.stdout);
  assert.equal(packEntries.length, 1, "npm pack must produce exactly one package");
  const filename = packEntries[0]?.filename;
  assert.equal(typeof filename, "string", "npm pack must report the candidate filename");
  const tarballs = (await readdir(output)).filter((entry) => entry.endsWith(".tgz"));
  assert.deepEqual(tarballs, [filename], "artifact output must contain exactly the npm-reported tarball");

  const packagePath = path.join(output, filename);
  const sha256 = await sha256File(packagePath);
  const manifest = {
    schemaVersion: 1,
    package: {
      name: packageJson.name,
      version: packageJson.version,
      filename,
      sha256
    },
    source: {
      commit,
      tag: `v${packageJson.version}`,
      dirty
    },
    runtime: {
      node: process.version,
      npm: npmVersion,
      platform: process.platform,
      architecture: process.arch
    },
    createdAt: new Date().toISOString()
  };
  const manifestPath = path.join(output, "artifact-manifest.json");
  const checksumsPath = path.join(output, "SHA256SUMS");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(checksumsPath, `${sha256}  ${filename}\n`, "utf8");
  await verifyArtifact({ packagePath, manifestPath, checksumsPath });
  return { packagePath, manifestPath, checksumsPath, manifest };
}

async function main() {
  const { values, flags } = parseNamedArguments(process.argv.slice(2), ["--output"], ["--allow-dirty"]);
  const outputDirectory = values.get("--output");
  if (outputDirectory === undefined) {
    throw new Error("Usage: node scripts/artifact/build.mjs --output <directory> [--allow-dirty]");
  }
  const result = await buildArtifact({ outputDirectory, allowDirty: flags.has("--allow-dirty") });
  console.log(JSON.stringify({
    package: result.packagePath,
    manifest: result.manifestPath,
    checksums: result.checksumsPath,
    sha256: result.manifest.package.sha256
  }));
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
