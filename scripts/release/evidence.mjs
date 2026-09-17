import assert from "node:assert/strict";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readArtifactManifest } from "../artifact/manifest.mjs";
import { verifyArtifact } from "../artifact/verify.mjs";

export function verifyReport(report, identity, { platform, runtime = false, now = Date.now() } = {}) {
  assert.equal(report.schemaVersion, 1, "unsupported evidence schema");
  assert.equal(report.status, "passed", "evidence must pass");
  assert.deepEqual(report.artifact, identity, "evidence must identify the exact candidate bytes");
  const start = Date.parse(report.startedAt);
  const end = Date.parse(report.completedAt);
  assert.ok(Number.isFinite(start) && Number.isFinite(end) && end >= start, "invalid evidence timestamps");
  assert.ok(end <= now + 300_000 && start >= now - 72 * 3600_000, "evidence is future-dated or older than 72 hours");
  if (!runtime) {
    assert.equal(report.platform, platform, "wrong gate platform");
    assert.deepEqual([...report.checks].sort(), ["artifact", "package-smoke", "packaged-e2e"].sort());
    return;
  }
  assert.equal(report.runtimes.length, 1, "exactly one Codex runtime is required");
  const codex = report.runtimes[0];
  assert.equal(codex.name, "codex");
  assert.equal(codex.status, "passed");
  assert.ok(typeof codex.cliVersion === "string" && codex.cliVersion.length > 0, "missing CLI version");
  assert.deepEqual(codex.probes.map((probe) => probe.probe).sort(), ["agent", "instruction", "mcp", "skill"]);
  for (const probe of codex.probes) {
    assert.equal(probe.runtime, "codex");
    assert.equal(probe.status, "passed", `${probe.probe} did not pass`);
    assert.equal(probe.failureClass, null);
    assert.equal(probe.markerObserved, true);
    assert.equal(probe.requiredEventObserved, true);
    assert.ok(Number.isFinite(probe.durationMs) && probe.durationMs >= 0);
    assert.ok(probe.attempts === 1 || probe.attempts === 2);
    if (probe.probe === "mcp") assert.equal(probe.fixtureToolCallObserved, true, "missing local MCP call confirmation");
  }
}

export async function verifyReleaseEvidence(directory, expectedCommit) {
  assert.match(expectedCommit, /^[a-f0-9]{40}$/u, "an immutable source commit is required");
  const root = path.resolve(directory);
  const manifestPath = path.join(root, "candidate", "artifact-manifest.json");
  const manifest = await readArtifactManifest(manifestPath);
  assert.equal(manifest.source.dirty, false, "release source must be clean");
  assert.equal(manifest.package.name, "harnessbrew");
  assert.match(manifest.package.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
  const packagePath = path.join(root, "candidate", manifest.package.filename);
  await verifyArtifact({ packagePath, manifestPath,
    checksumsPath: path.join(root, "candidate", "SHA256SUMS"), expectedCommit });
  const identity = { filename: manifest.package.filename, version: manifest.package.version,
    sha256: manifest.package.sha256, commit: manifest.source.commit };
  for (const [folder, platform] of [["linux", "linux"], ["macos", "darwin"]]) {
    verifyReport(JSON.parse(await readFile(path.join(root, folder, "release-gate.json"), "utf8")), identity, { platform });
  }
  verifyReport(JSON.parse(await readFile(path.join(root, "runtime", "runtime-report.json"), "utf8")), identity, { runtime: true });
  return { manifest, packagePath, root };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await verifyReleaseEvidence(process.argv[2], process.env.RELEASE_COMMIT);
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
      `version=${result.manifest.package.version}\ntag=${result.manifest.source.tag}\nsha256=${result.manifest.package.sha256}\n`);
    console.log(`All release evidence passed for ${result.manifest.source.tag} (${result.manifest.package.sha256}).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
