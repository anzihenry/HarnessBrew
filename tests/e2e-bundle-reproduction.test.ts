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

test("packaged CLI reproduces a locked Bundle in another home and cleans managed residue", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-bundle-candidate-"));
  const reportDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-bundle-report-"));
  const artifact = await artifactModule.buildArtifact({ outputDirectory, allowDirty: true });
  await runnerModule.runPackagedE2E({ ...artifact, reportDirectory, scenarios: ["bundle-reproduction"] });

  const report = JSON.parse(await readFile(path.join(reportDirectory, "e2e-report.json"), "utf8")) as {
    scenarios: Array<{ name: string; status: string }>;
    commands: Array<{ args: string[]; cwd: string }>;
  };
  assert.deepEqual(report.scenarios.map(({ name, status }) => ({ name, status })), [
    { name: "bundle-reproduction", status: "passed" }
  ]);
  assert.equal(report.commands.filter((command) => command.args[0] === "bundle" && command.args[1] === "install").length, 2);
  assert.equal(report.commands.filter((command) => command.args[0] === "bundle" && command.args[1] === "cleanup").length, 2);
  assert.equal(new Set(report.commands.map((command) => command.cwd).filter((cwd) => cwd.includes("bundle-machine"))).size, 2);
});
