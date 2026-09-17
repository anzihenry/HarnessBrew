import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const { verifyReport, verifyReleaseEvidence } = await import(pathToFileURL(path.resolve("scripts/release/evidence.mjs")).href);
const { assertApproval } = await import(pathToFileURL(path.resolve("scripts/release/github.mjs")).href);
const { ensureTag, ensureRegistryPackage, ensureAsset } = await import(pathToFileURL(path.resolve("scripts/release/publish.mjs")).href);
const bytes = Buffer.from("immutable candidate");
const identity = { filename: "harnessbrew-0.7.2.tgz", version: "0.7.2",
  sha256: createHash("sha256").update(bytes).digest("hex"), commit: "a".repeat(40) };

function runtimeReport(): any {
  return {
    schemaVersion: 1, status: "passed", artifact: { ...identity },
    startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
    runtimes: [{ name: "codex", cliVersion: "codex test-version", status: "passed", probes:
      ["skill", "instruction", "agent", "mcp"].map((probe) => ({
        runtime: "codex", probe, status: "passed", failureClass: null, markerObserved: true,
        requiredEventObserved: true, durationMs: 1, attempts: 1,
        ...(probe === "mcp" ? { fixtureToolCallObserved: true } : {})
      })) }]
  };
}

test("release evidence verifier reads the real tarball and rejects dirty, changed, or missing files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-release-evidence-"));
  try {
    for (const folder of ["candidate", "linux", "macos", "runtime", "package"]) {
      await mkdir(path.join(root, folder));
    }
    await writeFile(path.join(root, "package", "package.json"), JSON.stringify({
      name: "harnessbrew", version: identity.version, bin: { harnessbrew: "dist/bin.js" }
    }));
    const tarball = path.join(root, "candidate", identity.filename);
    await promisify(execFile)("tar", ["-czf", tarball, "-C", root, "package"]);
    const sha256 = createHash("sha256").update(await readFile(tarball)).digest("hex");
    const artifact = { ...identity, sha256 };
    const manifest = {
      schemaVersion: 1, package: { name: "harnessbrew", version: identity.version, filename: identity.filename, sha256 },
      source: { commit: identity.commit, tag: "v0.7.2", dirty: false },
      runtime: { node: "22", npm: "11", platform: "linux", architecture: "x64" }, createdAt: new Date().toISOString()
    };
    const manifestPath = path.join(root, "candidate", "artifact-manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(path.join(root, "candidate", "SHA256SUMS"), `${sha256}  ${identity.filename}\n`);
    for (const [folder, platform] of [["linux", "linux"], ["macos", "darwin"]] as const) {
      await writeFile(path.join(root, folder, "release-gate.json"), JSON.stringify({
        schemaVersion: 1, status: "passed", artifact, platform,
        startedAt: manifest.createdAt, completedAt: manifest.createdAt,
        checks: ["artifact", "package-smoke", "packaged-e2e"]
      }));
    }
    const runtimePath = path.join(root, "runtime", "runtime-report.json");
    await writeFile(runtimePath, JSON.stringify({ ...runtimeReport(), artifact }));
    assert.equal((await verifyReleaseEvidence(root, identity.commit)).packagePath, tarball);
    await assert.rejects(verifyReleaseEvidence(root, "b".repeat(40)), /expected commit/u);
    await writeFile(manifestPath, JSON.stringify({ ...manifest, source: { ...manifest.source, dirty: true } }));
    await assert.rejects(verifyReleaseEvidence(root, identity.commit), /must be clean/u);
    await writeFile(manifestPath, JSON.stringify(manifest));
    await rm(runtimePath);
    await assert.rejects(verifyReleaseEvidence(root, identity.commit), /ENOENT/u);
    await writeFile(runtimePath, JSON.stringify({ ...runtimeReport(), artifact }));
    await writeFile(tarball, "tampered");
    await assert.rejects(verifyReleaseEvidence(root, identity.commit), /SHA-256/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("release evidence requires every runtime probe and exact candidate identity", () => {
  verifyReport(runtimeReport(), identity, { runtime: true });
  const mutations: Array<(report: any) => void> = [
    (r) => { r.status = "incomplete"; },
    (r) => { r.schemaVersion = 2; },
    (r) => { r.artifact.sha256 = "b".repeat(64); },
    (r) => { r.artifact.commit = "b".repeat(40); },
    (r) => { r.artifact.version = "0.7.1"; },
    (r) => { r.runtimes = []; },
    (r) => { r.runtimes[0].cliVersion = null; },
    (r) => { r.runtimes[0].probes.pop(); },
    (r) => { r.runtimes[0].probes[3].probe = "skill"; },
    (r) => { r.runtimes[0].probes[0].status = "skipped"; },
    (r) => { r.runtimes[0].probes[0].failureClass = "environment-failure"; },
    (r) => { r.runtimes[0].probes[2].requiredEventObserved = false; },
    (r) => { r.runtimes[0].probes[0].markerObserved = false; },
    (r) => { delete r.runtimes[0].probes[3].fixtureToolCallObserved; },
    (r) => { r.startedAt = "invalid"; },
    (r) => { r.startedAt = new Date(Date.now() - 73 * 3600_000).toISOString(); },
    (r) => { r.completedAt = new Date(Date.now() + 3600_000).toISOString(); }
  ];
  for (const mutate of mutations) {
    const report = runtimeReport();
    mutate(report);
    assert.throws(() => verifyReport(report, identity, { runtime: true }));
  }
});

test("release evidence requires matching platform and all deterministic checks", () => {
  const report = { ...runtimeReport(), platform: "linux", checks: ["artifact", "package-smoke", "packaged-e2e"] };
  verifyReport(report, identity, { platform: "linux" });
  assert.throws(() => verifyReport(report, identity, { platform: "darwin" }));
  assert.throws(() => verifyReport({ ...report, checks: ["artifact"] }, identity, { platform: "linux" }));
});

test("publication refuses an environment without actual required reviewers", () => {
  for (const environment of [null, {}, { protection_rules: [] },
    { protection_rules: [{ type: "required_reviewers", reviewers: [] }] }]) {
    assert.throws(() => assertApproval(environment), /required reviewer/u);
  }
  assertApproval({ protection_rules: [{ type: "required_reviewers", reviewers: [{ id: 123 }] }] });
});

test("release tags are created once and conflicting tags are never moved", async () => {
  const calls: unknown[] = [];
  await ensureTag("v0.7.2", identity.commit, async (...args: unknown[]) => { calls.push(args); return null; });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], ["git/refs", { method: "POST", body: { ref: "refs/tags/v0.7.2", sha: identity.commit } }]);
  await ensureTag("v0.7.2", identity.commit, async () => ({ object: { type: "commit", sha: identity.commit } }));
  await assert.rejects(ensureTag("v0.7.2", identity.commit,
    async () => ({ object: { type: "commit", sha: "b".repeat(40) } })), /never move/u);
  let reads = 0;
  await ensureTag("v0.7.2", identity.commit, async () => ({ object: ++reads === 1
    ? { type: "tag", sha: "c".repeat(40) } : { type: "commit", sha: identity.commit } }));
});

test("npm recovery skips only byte-identical published versions and fails closed on network errors", async () => {
  const manifest = { package: { name: "harnessbrew", ...identity } };
  const execute = async () => { throw new Error("must not publish"); };
  const requestFor = (content: Buffer) => async (url: URL | string) => String(url).endsWith(".tgz")
    ? { ok: true, arrayBuffer: async () => content }
    : { ok: true, json: async () => ({ name: "harnessbrew", version: identity.version,
      dist: { tarball: "https://registry.npmjs.org/harnessbrew/-/harnessbrew-0.7.2.tgz" } }) };
  assert.equal(await ensureRegistryPackage(manifest, "/candidate.tgz", { request: requestFor(bytes), execute }), "already-published");
  await assert.rejects(ensureRegistryPackage(manifest, "/candidate.tgz",
    { request: requestFor(Buffer.from("different")), execute }), /different bytes/u);
  await assert.rejects(ensureRegistryPackage(manifest, "/candidate.tgz",
    { request: async () => ({ status: 503, ok: false }), execute }), /HTTP 503/u);
  let published: unknown[] = [];
  assert.equal(await ensureRegistryPackage(manifest, "/candidate.tgz", {
    request: async () => ({ status: 404 }), execute: async (...args: unknown[]) => { published = args; }
  }), "published");
  assert.deepEqual(published.slice(0, 2), ["npm", ["publish", "/candidate.tgz", "--provenance", "--access", "public", "--registry", "https://registry.npmjs.org"]]);
});

test("release attachments are verified after upload and never overwritten on retry", async () => {
  const release = { assets: [{ name: "candidate.tgz", id: 1 }], upload_url: "https://uploads.github.com/repos/owner/repo/releases/1/assets{?name,label}" };
  await ensureAsset(release, "candidate.tgz", bytes, { api: async () => bytes });
  await assert.rejects(ensureAsset(release, "candidate.tgz", Buffer.from("changed"), { api: async () => bytes }), /refusing overwrite/u);
  await ensureAsset({ ...release, assets: [] }, "candidate.tgz", bytes, {
    request: async () => ({ ok: true, json: async () => ({ id: 2 }) }), api: async () => bytes
  });
  await assert.rejects(ensureAsset({ ...release, assets: [] }, "candidate.tgz", bytes, {
    request: async () => ({ ok: true, json: async () => ({ id: 2 }) }), api: async () => Buffer.from("corrupt")
  }), /uploaded release asset differs/u);
});
