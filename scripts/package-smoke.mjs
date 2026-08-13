import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parseNamedArguments } from "./artifact/manifest.mjs";
import { verifyArtifact } from "./artifact/verify.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

async function command(commandName, args, options = {}) {
  return execFileAsync(commandName, args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...options
  });
}

export async function smokePackage({ packagePath, manifestPath, checksumsPath, cachePath }) {
  const verified = await verifyArtifact({
    packagePath,
    manifestPath,
    ...(checksumsPath === undefined ? {} : { checksumsPath })
  });
  const packageRoot = await mkdtemp(path.join(tmpdir(), "harnessbrew-package-smoke-"));
  const installRoot = path.join(packageRoot, "install");
  const npmCache = path.resolve(cachePath ?? path.join(projectRoot, ".npm-cache"));

  try {
    const listing = (await command("tar", ["-tzf", verified.packagePath])).stdout
      .split(/\r?\n/u)
      .filter((entry) => entry !== "");
    assert.ok(listing.includes("package/package.json"), "candidate must contain package.json");
    assert.ok(listing.includes("package/dist/bin.js"), "candidate must contain the executable module");
    const forbidden = listing.filter((entry) => /(?:^|\/)(?:tests?|scripts|\.npm-cache|\.test-dist)(?:\/|$)/u.test(entry));
    assert.deepEqual(forbidden, [], `candidate contains development-only files: ${forbidden.join(", ")}`);

    await command(npmCommand, [
      "install",
      "--prefix",
      installRoot,
      verified.packagePath,
      "--ignore-scripts",
      "--package-lock=false",
      "--cache",
      npmCache
    ]);

    const binaryPath = path.join(
      installRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "harnessbrew.cmd" : "harnessbrew"
    );
    await access(binaryPath);
    assert.ok(binaryPath.startsWith(`${installRoot}${path.sep}`), "smoke test must execute the candidate installed in its isolated prefix");

    const versionResult = await command(binaryPath, ["--version"], {
      cwd: installRoot,
      shell: process.platform === "win32"
    });
    assert.equal(versionResult.stdout.trim(), verified.manifest.package.version);
    const helpResult = await command(binaryPath, ["help"], {
      cwd: installRoot,
      shell: process.platform === "win32"
    });
    assert.match(helpResult.stdout, /Git-native package manager for AI Agent assets/u);

    const apiResult = await command(process.execPath, [
      "--input-type=module",
      "--eval",
      'import { TARGET_ADAPTER_API_VERSION, addAdapterPlugin, registerTargetAdapter } from "harnessbrew"; console.log(`${TARGET_ADAPTER_API_VERSION}:${typeof registerTargetAdapter}:${typeof addAdapterPlugin}`);'
    ], { cwd: installRoot });
    assert.equal(apiResult.stdout.trim(), "1:function:function");

    const installedPackage = JSON.parse(await readFile(
      path.join(installRoot, "node_modules", "harnessbrew", "package.json"),
      "utf8"
    ));
    assert.equal(installedPackage.name, verified.manifest.package.name);
    assert.equal(installedPackage.version, verified.manifest.package.version);
    assert.equal(installedPackage.engines?.node, ">=22");

    return {
      package: verified.manifest.package,
      binaryPath,
      installedPackage: path.join(installRoot, "node_modules", "harnessbrew")
    };
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = parseNamedArguments(process.argv.slice(2), [
    "--package",
    "--manifest",
    "--checksums",
    "--cache"
  ]);
  const packagePath = values.get("--package");
  const manifestPath = values.get("--manifest");
  if (packagePath === undefined || manifestPath === undefined) {
    throw new Error("Usage: node scripts/package-smoke.mjs --package <candidate.tgz> --manifest <artifact-manifest.json> [--checksums <SHA256SUMS>] [--cache <npm-cache>]");
  }
  const result = await smokePackage({
    packagePath,
    manifestPath,
    ...(values.get("--checksums") === undefined ? {} : { checksumsPath: values.get("--checksums") }),
    ...(values.get("--cache") === undefined ? {} : { cachePath: values.get("--cache") })
  });
  console.log(`Package smoke test passed for ${result.package.name}@${result.package.version}.`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
