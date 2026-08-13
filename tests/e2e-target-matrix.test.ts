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
interface RunnerModule {
  runPackagedE2E(options: ArtifactResult & { reportDirectory: string; scenarios: string[] }): Promise<unknown>;
}

const artifactModule = await import(pathToFileURL(path.resolve("scripts/artifact/build.mjs")).href) as ArtifactModule;
const runnerModule = await import(pathToFileURL(path.resolve("scripts/e2e/run.mjs")).href) as RunnerModule;

test("packaged CLI installs all Formula, Target, and scope placements", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-matrix-candidate-"));
  const reportDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-matrix-report-"));
  const artifact = await artifactModule.buildArtifact({ outputDirectory, allowDirty: true });
  await runnerModule.runPackagedE2E({ ...artifact, reportDirectory, scenarios: ["target-matrix"] });
  const report = JSON.parse(await readFile(path.join(reportDirectory, "e2e-report.json"), "utf8")) as {
    scenarios: Array<{ name: string; status: string }>;
    commands: Array<{ args: string[]; exitCode: number }>;
  };
  assert.equal(report.scenarios[0]?.name, "target-matrix");
  assert.equal(report.scenarios[0]?.status, "passed");
  assert.equal(report.commands.filter((command) => command.args[0] === "link" && command.exitCode === 0).length, 24);
  assert.ok(report.commands.some((command) => command.args[0] === "doctor"));
});
