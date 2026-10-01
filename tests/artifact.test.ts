import { buildTestArtifact } from "./helpers/artifact.js";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

interface ArtifactModule {
  parsePackEntries(output: string): Array<{ filename?: string }>;
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

test("artifact builder accepts npm 11 and npm 12 pack JSON", () => {
  const entry = { filename: "harnessbrew-0.7.1.tgz" };
  assert.deepEqual(artifactModule.parsePackEntries(JSON.stringify([entry])), [entry]);
  assert.deepEqual(artifactModule.parsePackEntries(JSON.stringify({ harnessbrew: entry })), [entry]);
  assert.throws(
    () => artifactModule.parsePackEntries(JSON.stringify({ error: { code: "EPERM", summary: "cache denied" } })),
    /npm pack failed: cache denied/u
  );
});

test("shared candidate contains a verifiable build manifest", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-artifact-"));
  const result = await buildTestArtifact({ outputDirectory, allowDirty: true });
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
  const result = await buildTestArtifact({ outputDirectory, allowDirty: true });
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
  const result = await buildTestArtifact({ outputDirectory, allowDirty: true });
  await writeFile(result.packagePath, "tampered", "utf8");

  await assert.rejects(verifyModule.verifyArtifact({
    packagePath: result.packagePath,
    manifestPath: result.manifestPath
  }), /candidate SHA-256 must match/u);
});
