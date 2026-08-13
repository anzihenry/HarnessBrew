import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

interface ArtifactResult { packagePath: string; manifestPath: string; checksumsPath: string }
interface ArtifactModule {
  buildArtifact(options: { outputDirectory: string; allowDirty?: boolean }): Promise<ArtifactResult>;
}
interface GateModule {
  runReleaseGate(options: Record<string, unknown>): Promise<{ report: Record<string, unknown>; reportPath: string }>;
}
const artifactModule = await import(pathToFileURL(path.resolve("scripts/artifact/build.mjs")).href) as ArtifactModule;
const gateModule = await import(pathToFileURL(path.resolve("scripts/release-gate.mjs")).href) as GateModule;

test("release gate passes one verified candidate to package smoke and E2E without rebuilding", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-gate-candidate-"));
  const reportDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-gate-report-"));
  const artifact = await artifactModule.buildArtifact({ outputDirectory, allowDirty: true });
  const calls: Array<{ stage: string; packagePath: string }> = [];
  const result = await gateModule.runReleaseGate({
    ...artifact,
    reportDirectory,
    smoke: async ({ packagePath }: { packagePath: string }) => { calls.push({ stage: "smoke", packagePath }); },
    e2e: async ({ packagePath }: { packagePath: string }) => { calls.push({ stage: "e2e", packagePath }); }
  });
  assert.deepEqual(calls, [
    { stage: "smoke", packagePath: artifact.packagePath },
    { stage: "e2e", packagePath: artifact.packagePath }
  ]);
  assert.equal(result.report.status, "passed");
  assert.deepEqual(result.report.checks, ["artifact", "package-smoke", "packaged-e2e"]);
  assert.equal(JSON.parse(await readFile(result.reportPath, "utf8")).status, "passed");
});

test("release gate entry point requires an explicit candidate and report directory", async () => {
  const { spawnCapture } = await import(pathToFileURL(path.resolve("scripts/runtime/process.mjs")).href) as {
    spawnCapture(command: string, args: string[], options: Record<string, unknown>): Promise<{ exitCode: number; stderr: string }>;
  };
  const result = await spawnCapture(process.execPath, [path.resolve("scripts/release-gate.mjs")], {
    cwd: path.resolve("."), timeoutMs: 5_000
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /--package <candidate\.tgz> --manifest/u);
});
