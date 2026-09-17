import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { verifyReleaseEvidence } from "./evidence.mjs";
import { assertApproval, github } from "./github.mjs";

const exec = promisify(execFile);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function ensureTag(tag, commit, api = github) {
  const ref = await api(`git/ref/tags/${encodeURIComponent(tag)}`, { allow404: true });
  if (ref === null) {
    await api("git/refs", { method: "POST", body: { ref: `refs/tags/${tag}`, sha: commit } });
    return;
  }
  let object = ref.object;
  for (let depth = 0; object.type === "tag" && depth < 5; depth++) {
    object = (await api(`git/tags/${object.sha}`)).object;
  }
  assert.equal(object.type, "commit", "release tag must resolve to a commit");
  assert.equal(object.sha, commit, "existing tag points to different source; never move release tags");
}

export async function ensureRegistryPackage(manifest, packagePath, { request = fetch, execute = exec } = {}) {
  const registry = "https://registry.npmjs.org";
  const response = await request(`${registry}/harnessbrew/${encodeURIComponent(manifest.package.version)}`, {
    signal: AbortSignal.timeout(60_000)
  });
  if (response.status === 404) {
    await execute("npm", ["publish", packagePath, "--provenance", "--access", "public", "--registry", registry], {
      timeout: 180_000, maxBuffer: 2 * 1024 * 1024
    });
    return "published";
  }
  assert.ok(response.ok, `Cannot inspect npm version: HTTP ${response.status}`);
  const metadata = await response.json();
  assert.equal(metadata.name, manifest.package.name);
  assert.equal(metadata.version, manifest.package.version);
  const url = new URL(metadata.dist.tarball);
  assert.equal(url.origin, registry, "unexpected registry tarball host");
  const tarball = await request(url, { signal: AbortSignal.timeout(60_000) });
  assert.ok(tarball.ok, `Cannot verify existing npm tarball: HTTP ${tarball.status}`);
  assert.equal(sha256(Buffer.from(await tarball.arrayBuffer())), manifest.package.sha256,
    "npm version already exists with different bytes; release a new version");
  return "already-published";
}

export async function ensureAsset(release, name, bytes, { api = github, request = fetch } = {}) {
  const existing = release.assets.filter((asset) => asset.name === name);
  assert.ok(existing.length <= 1, `duplicate release asset: ${name}`);
  if (existing.length === 1) {
    const remote = await api(`releases/assets/${existing[0].id}`, { accept: "application/octet-stream" });
    assert.equal(sha256(remote), sha256(bytes), `existing release asset differs: ${name}; refusing overwrite`);
    return;
  }
  const url = new URL(release.upload_url.replace(/\{.*$/u, ""));
  assert.equal(url.origin, "https://uploads.github.com");
  url.searchParams.set("name", name);
  const response = await request(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, "Content-Type": "application/octet-stream" },
    body: bytes, signal: AbortSignal.timeout(120_000)
  });
  assert.ok(response.ok, `upload ${name}: HTTP ${response.status}`);
  const uploaded = await response.json();
  const downloaded = await api(`releases/assets/${uploaded.id}`, { accept: "application/octet-stream" });
  assert.equal(sha256(downloaded), sha256(bytes), `uploaded release asset differs: ${name}`);
}

async function publish(directory) {
  assert.equal(process.env.GITHUB_REF, "refs/heads/main");
  assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
  assertApproval(await github("environments/npm-production"));
  const { manifest, packagePath, root } = await verifyReleaseEvidence(directory, process.env.RELEASE_COMMIT);
  const tag = manifest.source.tag;
  await ensureTag(tag, manifest.source.commit);
  // Listing includes draft releases; GET /releases/tags/:tag can omit drafts.
  let release;
  for (let page = 1; ; page++) {
    const releases = await github(`releases?per_page=100&page=${page}`);
    release = releases.find((item) => item.tag_name === tag);
    if (release || releases.length < 100) break;
  }
  if (!release) release = await github("releases", { method: "POST", body: {
    tag_name: tag, target_commitish: manifest.source.commit, name: tag, draft: true,
    prerelease: manifest.package.version.includes("-"),
    body: `Verified candidate SHA-256: ${manifest.package.sha256}\n\nSource: ${manifest.source.commit}\n\nRelease evidence is attached.`
  } });
  const files = [
    [manifest.package.filename, packagePath],
    ["artifact-manifest.json", path.join(root, "candidate", "artifact-manifest.json")],
    ["SHA256SUMS", path.join(root, "candidate", "SHA256SUMS")],
    ["release-gate-linux.json", path.join(root, "linux", "release-gate.json")],
    ["release-gate-macos.json", path.join(root, "macos", "release-gate.json")],
    ["runtime-report.json", path.join(root, "runtime", "runtime-report.json")]
  ];
  for (const [name, source] of files) await ensureAsset(release, name, await readFile(source));
  console.log(await ensureRegistryPackage(manifest, packagePath));
  await exec(process.execPath, [fileURLToPath(new URL("../registry-smoke.mjs", import.meta.url)), "--version", manifest.package.version], {
    timeout: 180_000, maxBuffer: 2 * 1024 * 1024
  });
  // Re-read and verify every required attachment before making the release public.
  const complete = await github(`releases/${release.id}`);
  for (const [name, source] of files) {
    assert.equal(complete.assets.filter((asset) => asset.name === name).length, 1, `missing release asset: ${name}`);
    await ensureAsset(complete, name, await readFile(source));
  }
  if (complete.draft) await github(`releases/${release.id}`, { method: "PATCH", body: { draft: false } });
  console.log(`Published ${tag} with all six verified attachments.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publish(process.argv[2]).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
