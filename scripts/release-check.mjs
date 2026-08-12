import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "..");

async function readProjectFile(relativePath) {
  return readFile(path.join(projectRoot, relativePath), "utf8");
}

export async function verifyRelease(requestedTag) {
  const packageJson = JSON.parse(await readProjectFile("package.json"));
  const packageLock = JSON.parse(await readProjectFile("package-lock.json"));
  const versionSource = await readProjectFile("src/version.ts");
  const changelog = await readProjectFile("CHANGELOG.md");
  const expectedTag = `v${packageJson.version}`;
  const releaseTag = requestedTag ?? expectedTag;

  assert.equal(releaseTag, expectedTag, `release tag ${releaseTag} must match ${expectedTag}`);
  assert.equal(packageLock.version, packageJson.version, "package-lock.json version must match package.json");
  assert.equal(
    packageLock.packages?.[""]?.version,
    packageJson.version,
    "package-lock.json root package version must match package.json"
  );
  assert.match(
    versionSource,
    new RegExp(`export const VERSION = ["']${packageJson.version.replaceAll(".", "\\.")}["'];`),
    "src/version.ts must match package.json"
  );
  assert.match(
    changelog,
    new RegExp(`^## ${packageJson.version.replaceAll(".", "\\.")} - \\d{4}-\\d{2}-\\d{2}$`, "m"),
    "CHANGELOG.md must contain a dated entry for the package version"
  );
  assert.equal(packageJson.bin?.harnessbrew, "dist/bin.js", "the npm executable must point to dist/bin.js");
  assert.ok(packageJson.files?.includes("dist"), "the npm package must include dist");
  assert.equal(packageJson.publishConfig?.access, "public", "the npm package must be public");
  assert.equal(
    packageJson.publishConfig?.registry,
    "https://registry.npmjs.org/",
    "the package must publish to the public npm registry"
  );

  return { name: packageJson.name, version: packageJson.version, tag: expectedTag };
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    const release = await verifyRelease(process.argv[2]);
    console.log(`Release source verified for ${release.name}@${release.version} (${release.tag}).`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
