import { buildTestArtifact } from "./helpers/artifact.js";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

interface SmokeModule {
  smokePackage(options: {
    packagePath: string;
    manifestPath: string;
    checksumsPath?: string;
  }): Promise<{ package: { name: string; version: string; sha256: string }; binaryPath: string }>;
}

const smokeModule = await import(pathToFileURL(path.resolve("scripts/package-smoke.mjs")).href) as SmokeModule;

test("package smoke installs and executes an explicitly provided candidate", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-package-candidate-"));
  const artifact = await buildTestArtifact({ outputDirectory, allowDirty: true });
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
