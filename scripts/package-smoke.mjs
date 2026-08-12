import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const projectRoot = new URL("../", import.meta.url);
const packageRoot = await mkdtemp(path.join(tmpdir(), "harnessbrew-package-"));
const installRoot = path.join(packageRoot, "install");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

try {
  await execFileAsync(npmCommand, [
    "pack",
    "--pack-destination",
    packageRoot,
    "--cache",
    path.join(projectRoot.pathname, ".npm-cache")
  ], { cwd: projectRoot, encoding: "utf8" });

  const tarballs = (await readdir(packageRoot)).filter((entry) => entry.endsWith(".tgz"));
  assert.equal(tarballs.length, 1, "npm pack should create exactly one tarball");
  await execFileAsync(npmCommand, [
    "install",
    "--prefix",
    installRoot,
    path.join(packageRoot, tarballs[0]),
    "--ignore-scripts",
    "--package-lock=false",
    "--cache",
    path.join(projectRoot.pathname, ".npm-cache")
  ], { encoding: "utf8" });

  const binaryPath = path.join(
    installRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "harnessbrew.cmd" : "harnessbrew"
  );
  await access(binaryPath);
  const result = await execFileAsync(binaryPath, ["--version"], {
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  assert.equal(result.stdout.trim(), packageJson.version);
  assert.equal(packageJson.devDependencies.typescript, "^7.0.2");
  console.log(`Package smoke test passed for harnessbrew@${packageJson.version}.`);
} finally {
  await rm(packageRoot, { recursive: true, force: true });
}
