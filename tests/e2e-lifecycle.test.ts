import { buildTestArtifact } from "./helpers/artifact.js";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

interface RunnerModule {
  runPackagedE2E(options: {
    packagePath: string;
    manifestPath: string;
    checksumsPath: string;
    reportDirectory: string;
    scenarios?: string[];
  }): Promise<{ artifact: { package: { filename: string; sha256: string } }; root: string }>;
}

const runnerModule = await import(pathToFileURL(path.resolve("scripts/e2e/run.mjs")).href) as RunnerModule;

test("packaged CLI completes the Tap-to-cleanup lifecycle", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-lifecycle-candidate-"));
  const reportDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-lifecycle-report-"));
  const artifact = await buildTestArtifact({ outputDirectory, allowDirty: true });
  const result = await runnerModule.runPackagedE2E({ ...artifact, reportDirectory, scenarios: ["lifecycle"] });

  await assert.rejects(access(result.root), /ENOENT/u);
  const report = JSON.parse(await readFile(path.join(reportDirectory, "e2e-report.json"), "utf8")) as {
    artifact: { sha256: string };
    scenarios: Array<{ name: string; status: string; durationMs: number }>;
    commands: Array<{ args: string[] }>;
  };
  assert.equal(report.artifact.sha256, result.artifact.package.sha256);
  assert.deepEqual(report.scenarios, [{ name: "lifecycle", status: "passed", durationMs: report.scenarios[0]?.durationMs }]);
  assert.ok(report.commands.some((command) => command.args[0] === "install"));
  assert.ok(report.commands.some((command) => command.args[0] === "doctor"));
  assert.ok(report.commands.some((command) => command.args[0] === "tap" && command.args[1] === "remove"));
});
