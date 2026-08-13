import assert from "node:assert/strict";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

interface ArtifactBuildResult {
  packagePath: string;
  manifestPath: string;
  checksumsPath: string;
}

interface ArtifactModule {
  buildArtifact(options: { outputDirectory: string; allowDirty?: boolean }): Promise<ArtifactBuildResult>;
}

interface E2EEnvironment {
  root: string;
  binary: string;
  environment: Record<string, string>;
  artifact: { package: { version: string; sha256: string }; source: object };
  paths: { project: string; reports: string; harnessHome: string };
  cleanup(): Promise<void>;
}

interface EnvironmentModule {
  assertPathInside(root: string, candidate: string): string;
  createE2EEnvironment(options: {
    packagePath: string;
    manifestPath: string;
    checksumsPath?: string;
  }): Promise<E2EEnvironment>;
}

interface DriverModule {
  PackagedCliDriver: new (
    environment: E2EEnvironment,
    options?: { onResult?: (result: unknown) => void }
  ) => {
    run(args: string[]): Promise<{ stdout: string }>;
    runJson(args: string[]): Promise<{ envelope: { result: { version: string } } }>;
  };
}

interface ReporterModule {
  E2EReporter: new (root: string, reports: string) => {
    recordCommand(result: unknown): void;
    recordScenario(name: string, status: string, durationMs: number): void;
    write(artifact: E2EEnvironment["artifact"]): Promise<{ jsonPath: string; summaryPath: string }>;
  };
}

const artifactModule = await import(pathToFileURL(path.resolve("scripts/artifact/build.mjs")).href) as ArtifactModule;
const environmentModule = await import(pathToFileURL(path.resolve("scripts/e2e/environment.mjs")).href) as EnvironmentModule;
const driverModule = await import(pathToFileURL(path.resolve("scripts/e2e/cli-driver.mjs")).href) as DriverModule;
const reporterModule = await import(pathToFileURL(path.resolve("scripts/e2e/reporter.mjs")).href) as ReporterModule;

test("packaged E2E harness isolates homes and executes only the installed candidate binary", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-e2e-candidate-"));
  const artifact = await artifactModule.buildArtifact({ outputDirectory, allowDirty: true });
  const environment = await environmentModule.createE2EEnvironment({
    packagePath: artifact.packagePath,
    manifestPath: artifact.manifestPath,
    checksumsPath: artifact.checksumsPath
  });
  const reporter = new reporterModule.E2EReporter(environment.root, environment.paths.reports);
  const driver = new driverModule.PackagedCliDriver(environment, {
    onResult: (result) => reporter.recordCommand(result)
  });
  const root = environment.root;

  try {
    assert.ok(environment.binary.startsWith(`${environment.root}${path.sep}`));
    assert.ok(environment.environment.HOME?.startsWith(`${environment.root}${path.sep}`));
    assert.ok(environment.environment.HARNESSBREW_HOME?.startsWith(`${environment.root}${path.sep}`));
    assert.equal(environment.environment.OPENAI_API_KEY, undefined);
    assert.equal(environment.environment.ANTHROPIC_API_KEY, undefined);

    const version = await driver.run(["--version"]);
    assert.equal(version.stdout.trim(), environment.artifact.package.version);
    const json = await driver.runJson(["version"]);
    assert.equal(json.envelope.result.version, environment.artifact.package.version);

    reporter.recordScenario("harness", "passed", 1);
    const report = await reporter.write(environment.artifact);
    await access(report.jsonPath);
    assert.match(await readFile(report.summaryPath, "utf8"), /harness.*passed/u);
  } finally {
    await environment.cleanup();
  }
  await assert.rejects(access(root), /ENOENT/u);
});

test("E2E path guard rejects destinations outside the isolated root", () => {
  const root = path.join(tmpdir(), "harnessbrew-e2e-guard");
  assert.equal(environmentModule.assertPathInside(root, path.join(root, "child")), path.join(root, "child"));
  assert.throws(() => environmentModule.assertPathInside(root, path.dirname(root)), /escapes its isolated root/u);
});
