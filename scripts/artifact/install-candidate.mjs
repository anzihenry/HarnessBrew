import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function localProductionDependencies(projectRoot) {
  const packageJson = JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  const dependencies = Object.keys(packageJson.dependencies ?? {}).sort();
  return Promise.all(dependencies.map(async (name) => {
    const dependencyPath = path.join(projectRoot, "node_modules", ...name.split("/"));
    await access(path.join(dependencyPath, "package.json"));
    return dependencyPath;
  }));
}

export async function installCandidate({ packagePath, installPrefix, projectRoot, cachePath, environment }) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const localDependencies = await localProductionDependencies(projectRoot);
  return execFileAsync(npmCommand, [
    "install",
    "--prefix",
    path.resolve(installPrefix),
    path.resolve(packagePath),
    ...localDependencies,
    "--ignore-scripts",
    "--package-lock=false",
    "--cache",
    path.resolve(cachePath),
    "--offline"
  ], {
    encoding: "utf8",
    env: environment,
    maxBuffer: 10 * 1024 * 1024
  });
}
