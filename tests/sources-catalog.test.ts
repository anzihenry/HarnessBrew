import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SourceManager } from "../src/sources/manager.js";
import { loadCatalog } from "../src/catalog/load.js";
import { git, commitFile } from "./helpers/git.js";

async function fixture(t: TestContext, algorithm = "sha1") {
  const root = await mkdtemp(path.join(os.tmpdir(), "hb-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = path.join(root, "repository"), cache = path.join(root, "cache");
  await mkdir(repository);
  await git(repository, "init", "--initial-branch=main", `--object-format=${algorithm}`);
  await git(repository, "config", "user.name", "Test");
  await git(repository, "config", "user.email", "test@example.com");
  await mkdir(path.join(repository, "assets/a"), { recursive: true });
  await writeFile(path.join(repository, "tap.json"), JSON.stringify({ format: "harnessbrew.tap", version: 1 }));
  await writeFile(path.join(repository, "assets/a/asset.json"), JSON.stringify({ format: "harnessbrew.asset", version: 1, kind: "skill", entry: "SKILL.md", description: "Example", dependencies: [], conflicts: [], targets: ["codex"] }));
  await writeFile(path.join(repository, "assets/a/SKILL.md"), "# A\n");
  await git(repository, "add", "."); await git(repository, "commit", "-m", "initial");
  return { root, repository, manager: new SourceManager(cache), request: { name: "test/assets", url: repository } };
}

test("Git snapshots and catalog preserve exact commits, binary bytes and executable modes", async t => {
  const { repository, manager, request } = await fixture(t);
  const binary = Buffer.from([0, 255, 128, 10, 13]);
  await writeFile(path.join(repository, "assets/a/binary file"), binary);
  await chmod(path.join(repository, "assets/a/binary file"), 0o755);
  await git(repository, "add", "."); await git(repository, "commit", "-m", "binary");
  await git(repository, "tag", "v1");
  const first = await manager.prepare(request);
  assert.equal(first.commit.value, await git(repository, "rev-parse", "HEAD"));
  assert.deepEqual(await readFile(path.join(first.contentLocation, "assets/a/binary file")), binary);
  assert.equal((await lstat(path.join(first.contentLocation, "assets/a/binary file"))).mode & 0o777, 0o755);
  const newerCommit = await commitFile(repository, "assets/a/SKILL.md", "# New\n");
  const second = await manager.prepare({ ...request, previous: first });
  assert.equal(second.commit.value, newerCommit);
  assert.equal(await readFile(path.join(first.contentLocation, "assets/a/SKILL.md"), "utf8"), "# A\n");
  assert.deepEqual(await manager.prepare({ ...request, ref: "v1" }), first);
  assert.deepEqual(await manager.prepare({ ...request, commit: first.commit }), first);
  const cat = await loadCatalog([first, second], [second.id]);
  assert.equal(cat.assets.length, 2);
  assert.ok(Object.isFrozen(cat.assets[0]!.manifest));
  assert.notEqual(cat.assets[0]!.contentDigest, cat.assets[1]!.contentDigest);
  assert.equal(await git(repository, "status", "--porcelain"), "");
});

test("source rejects rewind unless explicit, while exact commit replay remains allowed", async t => {
  const { repository, manager, request } = await fixture(t);
  const old = await manager.prepare(request);
  await commitFile(repository, "assets/a/SKILL.md", "new");
  const newer = await manager.prepare({ ...request, previous: old });
  await git(repository, "reset", "--hard", old.commit.value);
  await assert.rejects(manager.prepare({ ...request, previous: newer }), { code: "SOURCE_REWIND" });
  assert.deepEqual(await manager.prepare({ ...request, previous: newer, allowRewind: true }), old);
  assert.deepEqual(await manager.prepare({ ...request, previous: newer, commit: old.commit }), old);
  await assert.rejects(manager.prepare({ ...request, ref: "main~1" }), { code: "INVALID_ARGUMENT" });
});

test("cache mutation fails both Source Manager and Catalog validation", async t => {
  const { manager, request } = await fixture(t);
  const snapshot = await manager.prepare(request);
  await writeFile(path.join(snapshot.contentLocation, "assets/a/SKILL.md"), "tampered");
  await assert.rejects(manager.prepare(request), { code: "CONTENT_MODIFIED" });
  await assert.rejects(loadCatalog([snapshot], [snapshot.id]), { code: "CONTENT_MODIFIED" });
});

test("symlinks and submodules are rejected before snapshot publication", async t => {
  const { repository, manager, request } = await fixture(t);
  await symlink("SKILL.md", path.join(repository, "assets/a/link"));
  await git(repository, "add", "."); await git(repository, "commit", "-m", "link");
  await assert.rejects(manager.prepare(request), { code: "CONTENT_MODIFIED" });
  await git(repository, "rm", "assets/a/link");
  await git(repository, "update-index", "--add", "--cacheinfo", `160000,${await git(repository, "rev-parse", "HEAD")},module`);
  await git(repository, "commit", "-m", "submodule");
  await assert.rejects(manager.prepare(request), { code: "CONTENT_MODIFIED" });
});

test("parallel preparations share the same verified snapshot; SHA256 repositories work", async t => {
  const { manager, request } = await fixture(t, "sha256");
  const [a, b] = await Promise.all([manager.prepare(request), manager.prepare(request)]);
  assert.deepEqual(a, b);
  assert.equal(a.commit.algorithm, "sha256");
  assert.equal(a.commit.value.length, 64);
  assert.equal((await loadCatalog([a], [a.id])).assets.length, 1);
});

test("catalog rejects legacy declarations and multiple selected versions of one Tap", async t => {
  const { repository, manager, request } = await fixture(t);
  const first = await manager.prepare(request);
  await commitFile(repository, "tap.json", '{"schemaVersion":1}');
  const legacy = await manager.prepare(request);
  await assert.rejects(loadCatalog([legacy], [legacy.id]), { code: "UNSUPPORTED_FORMAT" });
  await assert.rejects(loadCatalog([first, legacy], [first.id, legacy.id]), { code: "INVALID_STATE" });
});

test("source content is read without checkout filters", async t => {
  const { repository, manager, request } = await fixture(t);
  await commitFile(repository, ".gitattributes", "*.md filter=unavailable\n");
  const snapshot = await manager.prepare(request);
  assert.equal(await readFile(path.join(snapshot.contentLocation, "assets/a/SKILL.md"), "utf8"), "# A\n");
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(manager.prepare({ ...request, signal: aborted.signal }));
});

test("binary Git failures remain structured and do not publish partial snapshots", async t => {
  const { root, request } = await fixture(t);
  const { nodeGitClient } = await import("../src/ports/io.js");
  const manager = new SourceManager(path.join(root, "failed-cache"), {
    run: command => nodeGitClient.run(command),
    bytes: async () => { throw new Error("injected object read failure"); }
  });
  await assert.rejects(manager.prepare(request), { code: "GIT_FAILED" });
  const { readdir } = await import("node:fs/promises");
  assert.deepEqual(await readdir(path.join(root, "failed-cache/snapshots")), []);
});
