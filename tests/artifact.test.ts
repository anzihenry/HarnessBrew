import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

interface ArtifactBuildResult {
  packagePath: string;
  manifestPath: string;
  checksumsPath: string;
  manifest: {
    package: { name: string; version: string; filename: string; sha256: string };
    source: { commit: string; tag: string; dirty: boolean };
  };
}

interface ArtifactModule {
  buildArtifact(options: { outputDirectory: string; allowDirty?: boolean }): Promise<ArtifactBuildResult>;
}

interface VerifyModule {
  verifyArtifact(options: {
    packagePath: string;
    manifestPath: string;
    checksumsPath?: string;
    expectedCommit?: string;
    expectedTag?: string;
    expectedVersion?: string;
  }): Promise<unknown>;
}

const artifactModule = await import(pathToFileURL(path.resolve("scripts/artifact/build.mjs")).href) as ArtifactModule;
const verifyModule = await import(pathToFileURL(path.resolve("scripts/artifact/verify.mjs")).href) as VerifyModule;

test("artifact builder packs once and records a verifiable candidate manifest", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-artifact-"));
  const result = await artifactModule.buildArtifact({ outputDirectory, allowDirty: true });
  const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as { name: string; version: string };

  assert.equal(result.manifest.package.name, packageJson.name);
  assert.equal(result.manifest.package.version, packageJson.version);
  assert.equal(result.manifest.source.tag, `v${packageJson.version}`);
  assert.match(result.manifest.source.commit, /^[a-f0-9]{40}$/u);
  assert.match(result.manifest.package.sha256, /^[a-f0-9]{64}$/u);
  await verifyModule.verifyArtifact({
    packagePath: result.packagePath,
    manifestPath: result.manifestPath,
    checksumsPath: result.checksumsPath
  });
});

test("artifact verification enforces expected release identity", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-artifact-identity-"));
  const result = await artifactModule.buildArtifact({ outputDirectory, allowDirty: true });
  await verifyModule.verifyArtifact({
    packagePath: result.packagePath,
    manifestPath: result.manifestPath,
    checksumsPath: result.checksumsPath,
    expectedCommit: result.manifest.source.commit,
    expectedTag: result.manifest.source.tag,
    expectedVersion: result.manifest.package.version
  });
  await assert.rejects(verifyModule.verifyArtifact({
    packagePath: result.packagePath,
    manifestPath: result.manifestPath,
    expectedCommit: "0".repeat(40)
  }), /source commit must match/u);
});

test("artifact verification rejects candidate byte changes", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-artifact-tamper-"));
  const result = await artifactModule.buildArtifact({ outputDirectory, allowDirty: true });
  await writeFile(result.packagePath, "tampered", "utf8");

  await assert.rejects(verifyModule.verifyArtifact({
    packagePath: result.packagePath,
    manifestPath: result.manifestPath
  }), /candidate SHA-256 must match/u);
});
