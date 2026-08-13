import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseNamedArguments } from "../artifact/manifest.mjs";
import { PackagedCliDriver } from "./cli-driver.mjs";
import { createE2EEnvironment } from "./environment.mjs";
import { E2EReporter } from "./reporter.mjs";
import { lifecycleScenario } from "./scenarios/lifecycle.mjs";
import { targetMatrixScenario } from "./scenarios/target-matrix.mjs";
import { upgradeRepairScenario } from "./scenarios/upgrade-repair.mjs";

const runnerPath = fileURLToPath(import.meta.url);
const scenarioRegistry = new Map([
  ["lifecycle", lifecycleScenario],
  ["target-matrix", targetMatrixScenario],
  ["upgrade-repair", upgradeRepairScenario]
]);

async function exportReports(reportPaths, destination) {
  if (destination === undefined) return;
  const resolved = path.resolve(destination);
  await mkdir(resolved, { recursive: true });
  await Promise.all([
    copyFile(reportPaths.jsonPath, path.join(resolved, path.basename(reportPaths.jsonPath))),
    copyFile(reportPaths.summaryPath, path.join(resolved, path.basename(reportPaths.summaryPath)))
  ]);
}

export async function runPackagedE2E({
  packagePath,
  manifestPath,
  checksumsPath,
  cachePath,
  reportDirectory,
  scenarios = ["lifecycle", "target-matrix", "upgrade-repair"],
  keepOnFailure = false
}) {
  const environment = await createE2EEnvironment({
    packagePath,
    manifestPath,
    ...(checksumsPath === undefined ? {} : { checksumsPath }),
    ...(cachePath === undefined ? {} : { cachePath })
  });
  const reporter = new E2EReporter(environment.root, environment.paths.reports);
  const cli = new PackagedCliDriver(environment, { onResult: (result) => reporter.recordCommand(result) });
  let failed;
  try {
    for (const name of scenarios) {
      const scenario = scenarioRegistry.get(name);
      if (scenario === undefined) throw new Error(`Unknown E2E scenario: ${name}`);
      const startedAt = Date.now();
      try {
        await scenario({ environment, cli });
        reporter.recordScenario(name, "passed", Date.now() - startedAt);
      } catch (error) {
        failed = error;
        reporter.recordScenario(name, "failed", Date.now() - startedAt, error);
        break;
      }
    }
    const reports = await reporter.write(environment.artifact);
    await exportReports(reports, reportDirectory);
    if (failed !== undefined) throw failed;
    return { artifact: environment.artifact, reports, root: environment.root };
  } finally {
    if (failed !== undefined && keepOnFailure) environment.preserve();
    await environment.cleanup();
  }
}

async function main() {
  const { values, flags } = parseNamedArguments(
    process.argv.slice(2),
    ["--package", "--manifest", "--checksums", "--cache", "--report-dir", "--scenario"],
    ["--keep-on-failure"]
  );
  const packagePath = values.get("--package");
  const manifestPath = values.get("--manifest");
  if (packagePath === undefined || manifestPath === undefined) {
    throw new Error("Usage: node scripts/e2e/run.mjs --package <candidate.tgz> --manifest <artifact-manifest.json> [--checksums <SHA256SUMS>] [--scenario <name>] [--report-dir <directory>] [--keep-on-failure]");
  }
  const result = await runPackagedE2E({
    packagePath,
    manifestPath,
    ...(values.get("--checksums") === undefined ? {} : { checksumsPath: values.get("--checksums") }),
    ...(values.get("--cache") === undefined ? {} : { cachePath: values.get("--cache") }),
    ...(values.get("--report-dir") === undefined ? {} : { reportDirectory: values.get("--report-dir") }),
    ...(values.get("--scenario") === undefined ? {} : { scenarios: [values.get("--scenario")] }),
    keepOnFailure: flags.has("--keep-on-failure")
  });
  console.log(`Packaged E2E passed for ${result.artifact.package.filename} (${result.artifact.package.sha256}).`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === runnerPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
