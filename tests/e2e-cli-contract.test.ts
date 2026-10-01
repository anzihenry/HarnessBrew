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

test("packaged CLI preserves the JSON contract and rolls dry-run mutations back", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-contract-candidate-"));
  const reportDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-contract-report-"));
  const artifact = await buildTestArtifact({ outputDirectory, allowDirty: true });
  await runnerModule.runPackagedE2E({ ...artifact, reportDirectory, scenarios: ["cli-contract"] });

  const report = JSON.parse(await readFile(path.join(reportDirectory, "e2e-report.json"), "utf8")) as {
    scenarios: Array<{ name: string; status: string }>;
    commands: Array<{ args: string[]; exitCode: number }>;
  };
  assert.deepEqual(report.scenarios.map(({ name, status }) => ({ name, status })), [
    { name: "cli-contract", status: "passed" }
  ]);
  assert.ok(report.commands.filter((command) => command.args.includes("--dry-run")).length >= 4);
  assert.ok(report.commands.some((command) => command.args[0] === "missing-command" && command.exitCode === 1));
  assert.ok(report.commands.some((command) => command.args[0] === "install" && command.exitCode === 1));
});
