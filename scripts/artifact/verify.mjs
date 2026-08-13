import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { parseNamedArguments, readArtifactManifest, sha256File } from "./manifest.mjs";

const execFileAsync = promisify(execFile);

export async function verifyArtifact({
  packagePath,
  manifestPath,
  checksumsPath,
  expectedCommit,
  expectedTag,
  expectedVersion
}) {
  const resolvedPackage = path.resolve(packagePath);
  const resolvedManifest = path.resolve(manifestPath);
  await access(resolvedPackage);
  const manifest = await readArtifactManifest(resolvedManifest);

  assert.equal(path.basename(resolvedPackage), manifest.package.filename, "candidate filename must match its manifest");
  assert.equal(await sha256File(resolvedPackage), manifest.package.sha256, "candidate SHA-256 must match its manifest");
  assert.equal(manifest.source.tag, `v${manifest.package.version}`, "candidate tag must match its package version");
  if (expectedCommit !== undefined) {
    assert.equal(manifest.source.commit, expectedCommit, "candidate source commit must match the expected commit");
  }
  if (expectedTag !== undefined) {
    assert.equal(manifest.source.tag, expectedTag, "candidate source tag must match the expected tag");
  }
  if (expectedVersion !== undefined) {
    assert.equal(manifest.package.version, expectedVersion, "candidate package version must match the expected version");
  }

  const { stdout } = await execFileAsync("tar", ["-xOf", resolvedPackage, "package/package.json"], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  const packageJson = JSON.parse(stdout);
  assert.equal(packageJson.name, manifest.package.name, "packed package name must match its manifest");
  assert.equal(packageJson.version, manifest.package.version, "packed package version must match its manifest");
  assert.equal(packageJson.bin?.harnessbrew, "dist/bin.js", "packed package must expose the harnessbrew executable");

  if (checksumsPath !== undefined) {
    const checksumLine = (await readFile(path.resolve(checksumsPath), "utf8")).trim();
    assert.equal(
      checksumLine,
      `${manifest.package.sha256}  ${manifest.package.filename}`,
      "SHA256SUMS must contain exactly the candidate digest and filename"
    );
  }

  return { packagePath: resolvedPackage, manifestPath: resolvedManifest, manifest };
}

async function main() {
  const { values } = parseNamedArguments(process.argv.slice(2), [
    "--package", "--manifest", "--checksums", "--expected-commit", "--expected-tag", "--expected-version"
  ]);
  const packagePath = values.get("--package");
  const manifestPath = values.get("--manifest");
  if (packagePath === undefined || manifestPath === undefined) {
    throw new Error("Usage: node scripts/artifact/verify.mjs --package <candidate.tgz> --manifest <artifact-manifest.json> [--checksums <SHA256SUMS>]");
  }
  const result = await verifyArtifact({
    packagePath,
    manifestPath,
    ...(values.get("--checksums") === undefined ? {} : { checksumsPath: values.get("--checksums") }),
    ...(values.get("--expected-commit") === undefined ? {} : { expectedCommit: values.get("--expected-commit") }),
    ...(values.get("--expected-tag") === undefined ? {} : { expectedTag: values.get("--expected-tag") }),
    ...(values.get("--expected-version") === undefined ? {} : { expectedVersion: values.get("--expected-version") })
  });
  console.log(`Verified ${result.manifest.package.filename} (${result.manifest.package.sha256}).`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
