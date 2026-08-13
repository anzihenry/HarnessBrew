import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

interface ArtifactBuildResult {
  packagePath: string;
  manifestPath: string;
  checksumsPath: string;
  manifest: { package: { name: string; version: string; sha256: string } };
}

interface ArtifactModule {
  buildArtifact(options: { outputDirectory: string; allowDirty?: boolean }): Promise<ArtifactBuildResult>;
}

interface SmokeModule {
  smokePackage(options: {
    packagePath: string;
    manifestPath: string;
    checksumsPath?: string;
  }): Promise<{ package: { name: string; version: string; sha256: string }; binaryPath: string }>;
}

const artifactModule = await import(pathToFileURL(path.resolve("scripts/artifact/build.mjs")).href) as ArtifactModule;
const smokeModule = await import(pathToFileURL(path.resolve("scripts/package-smoke.mjs")).href) as SmokeModule;

test("package smoke installs and executes an explicitly provided candidate", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-package-candidate-"));
  const artifact = await artifactModule.buildArtifact({ outputDirectory, allowDirty: true });
  const result = await smokeModule.smokePackage({
    packagePath: artifact.packagePath,
    manifestPath: artifact.manifestPath,
    checksumsPath: artifact.checksumsPath
  });

  assert.equal(result.package.name, "harnessbrew");
  assert.equal(result.package.version, artifact.manifest.package.version);
  assert.equal(result.package.sha256, artifact.manifest.package.sha256);
  assert.match(result.binaryPath, /node_modules[\/]+\.bin[\/]+harnessbrew(?:\.cmd)?$/u);
});

test("package smoke CLI refuses to create an implicit candidate", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [path.resolve("scripts/package-smoke.mjs")], { encoding: "utf8" }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /--package <candidate\.tgz>/u);
      return true;
    }
  );
});
