import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

interface ArtifactResult { packagePath: string; manifestPath: string; checksumsPath: string }
interface ArtifactModule {
  buildArtifact(options: { outputDirectory: string; allowDirty?: boolean }): Promise<ArtifactResult>;
}
interface PreflightModule {
  runRuntimePreflight(options: Record<string, unknown>): Promise<{
    report: { status: string; artifact: { sha256: string }; runtimes: Array<{ status: string; probes: unknown[] }> };
    reportPath: string;
  }>;
}
const artifactModule = await import(pathToFileURL(path.resolve("scripts/artifact/build.mjs")).href) as ArtifactModule;
const preflightModule = await import(pathToFileURL(path.resolve("scripts/runtime/preflight.mjs")).href) as PreflightModule;

function fakeAdapter(name: string, runtime: string) {
  return {
    name,
    runtime,
    binary: "unused",
    version: `${name} test-version`,
    async runProbe({ probe, fixture, cwd, environment }: {
      probe: { name: string };
      fixture: { mcpLog: string; markers: { mcp: string } };
      cwd: string;
      environment: NodeJS.ProcessEnv;
    }) {
      if (runtime === "codex") {
        assert.notEqual(environment.CODEX_HOME, process.env.CODEX_HOME);
        assert.match(await readFile(path.join(environment.CODEX_HOME as string, "config.toml"), "utf8"),
          /trust_level = "trusted"/u);
      }
      if (probe.name === "mcp") {
        assert.match(await readFile(path.join(cwd, ".codex", "config.toml"), "utf8"),
          /\[mcp_servers\.harnessbrew-runtime-mcp\]\ndefault_tools_approval_mode = "approve"/u);
        await appendFile(fixture.mcpLog, `${JSON.stringify({ event: "tool-called", nonce: fixture.markers.mcp })}\n`, "utf8");
      }
      return {
        runtime,
        probe: probe.name,
        status: "passed",
        failureClass: null,
        markerObserved: true,
        requiredEventObserved: true,
        durationMs: 1,
        evidence: { eventTypes: ["test"], toolCalls: [] }
      };
    }
  };
}

test("runtime preflight installs the exact candidate and emits redacted dual-runtime evidence", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-preflight-candidate-"));
  const reportDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-preflight-report-"));
  const artifact = await artifactModule.buildArtifact({ outputDirectory, allowDirty: true });
  process.env.HARNESSBREW_TEST_SECRET = "must-not-appear-in-runtime-evidence";
  try {
    const result = await preflightModule.runRuntimePreflight({
      ...artifact,
      reportDirectory,
      runtimeAdapters: [fakeAdapter("codex", "codex"), fakeAdapter("claude-code", "claude-code")]
    });
    assert.equal(result.report.status, "passed");
    assert.equal(result.report.runtimes.length, 2);
    assert.ok(result.report.runtimes.every((runtime) => runtime.status === "passed" && runtime.probes.length === 4));
    const evidence = await readFile(result.reportPath, "utf8");
    assert.doesNotMatch(evidence, /must-not-appear-in-runtime-evidence/u);
    const manifest = JSON.parse(await readFile(artifact.manifestPath, "utf8")) as { package: { sha256: string } };
    assert.equal(result.report.artifact.sha256, manifest.package.sha256);
  } finally {
    delete process.env.HARNESSBREW_TEST_SECRET;
  }
});

test("runtime preflight entry point refuses to create an implicit candidate", async () => {
  const { spawnCapture } = await import(pathToFileURL(path.resolve("scripts/runtime/process.mjs")).href) as {
    spawnCapture(command: string, args: string[], options: Record<string, unknown>): Promise<{ exitCode: number; stderr: string }>;
  };
  const result = await spawnCapture(process.execPath, [path.resolve("scripts/runtime/preflight.mjs")], {
    cwd: path.resolve("."), timeoutMs: 5_000
  });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /--package <candidate\.tgz> --manifest/u);
});
