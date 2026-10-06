import { buildTestArtifact } from "./helpers/artifact.js";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

interface ArtifactResult { packagePath: string; manifestPath: string; checksumsPath: string }
interface RunnerModule {
  runPackagedE2E(options: ArtifactResult & { reportDirectory: string; scenarios: string[] }): Promise<unknown>;
}
const runnerModule = await import(pathToFileURL(path.resolve("scripts/e2e/run.mjs")).href) as RunnerModule;

test("packaged CLI upgrades, rolls back invalid Taps, diagnoses drift, and repairs Targets", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-upgrade-candidate-"));
  const reportDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-upgrade-report-"));
  const artifact = await buildTestArtifact({ outputDirectory, allowDirty: true });
  await runnerModule.runPackagedE2E({ ...artifact, reportDirectory, scenarios: ["adapter-upgrade", "upgrade-repair"] });
  const report = JSON.parse(await readFile(path.join(reportDirectory, "e2e-report.json"), "utf8")) as {
    scenarios: Array<{ status: string }>;
    commands: Array<{ args: string[]; exitCode: number }>;
  };
  assert.equal(report.scenarios[0]?.status, "passed");
  assert.ok(report.commands.some((command) => command.args[0] === "upgrade"));
  assert.ok(report.commands.some((command) => command.args[0] === "repair" && command.exitCode === 0));
  assert.ok(report.commands.some((command) => command.args[0] === "repair" && command.exitCode === 1));
});
