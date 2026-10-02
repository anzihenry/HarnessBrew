import assert from "node:assert/strict";
import { lstat, mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createHarness, runCli } from "../src/index.js";
import type { ChangeRequest } from "../src/index.js";
import { StateStore } from "../src/storage/state-store.js";
import { applicationFixture } from "./helpers/application.js";

for (const kind of ["skill", "agent", "workflow", "prompt", "instruction", "mcp"]) test(`public SDK ${kind}: preview, apply, repeated install, doctor, remove, cleanup`, async t => {
  const f = await applicationFixture(t); await f.add("a", { kind }); await f.register();
  const before = await new StateStore(f.home).read();
  const request: ChangeRequest = { kind: "asset.install", coordinate: "a", placements: [f.placement] };
  const preview = await f.service.plan(request);
  assert.deepEqual(await new StateStore(f.home).read(), before);
  assert.ok(preview.fileUpdates.length > 0);
  const applied = await f.service.apply(preview.planId);
  assert.equal((await f.service.doctor()).healthy, true);
  assert.equal((await f.service.execute(request)).committedRevision, applied.committedRevision);
  await f.service.execute({ kind: "asset.remove", coordinate: "a" });
  const orphan = await new StateStore(f.home).read(); assert.equal(orphan.install.assets[0]?.status, "orphan");
  await f.service.execute({ kind: "cleanup" }); assert.deepEqual((await new StateStore(f.home).read()).install.assets, []);
  await assert.rejects(lstat(path.join(f.home, "content", orphan.install.assets[0]!.contentDigest.slice(7))), { code: "ENOENT" });
});

test("CLI and SDK share state and error codes; JSON is one versioned document", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  let stdout = "", stderr = "";
  const cli = async (...args: string[]) => { stdout = ""; stderr = ""; const code = await runCli([...args, "--json"], { stdout: s => { stdout += s; }, stderr: s => { stderr += s; } }, f.options); assert.equal(stderr, ""); return { code, body: JSON.parse(stdout) }; };
  assert.equal((await cli("install", "a", "--scope", "project")).code, 0);
  assert.deepEqual((await cli("list")).body.result, await f.service.query({ kind: "list" }));
  assert.equal((await cli("doctor")).body.ok, true);
  assert.equal((await cli("install", "unknown")).body.error.code, "ASSET_NOT_FOUND");
  await assert.rejects(f.service.execute({ kind: "asset.install", coordinate: "unknown" }), { code: "ASSET_NOT_FOUND" });
  for (const args of [["uninstall", "a"], ["list", "--dry-run"], ["install", "a", "--scope", "user", "--project", "."], ["list", "--wat"], ["list", "--home"], ["list", "--home", f.home, "--home", f.home]]) assert.equal((await cli(...args)).code, 2);
  assert.equal((await cli("list")).body.format, "harnessbrew.result");
});

test("saved plans reject revision, target, and manifest drift without implicit replanning", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  const preview = await f.service.plan({ kind: "asset.install", coordinate: "a", placements: [f.placement] });
  const target = preview.fileUpdates[0]!.path;
  await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, "user data");
  await assert.rejects(f.service.apply(preview.planId), { code: "PLAN_STALE" });
  assert.equal(await readFile(target, "utf8"), "user data"); await rm(target);
  const next = await f.service.plan({ kind: "asset.install", coordinate: "a", placements: [f.placement] });
  await f.service.execute({ kind: "tap.untrust", name: "test/assets" });
  await assert.rejects(f.service.apply(next.planId), { code: "PLAN_STALE" });
  await assert.rejects(f.service.apply("../../no"), { code: "PLAN_NOT_FOUND" });
});

test("repair only restores missing resources; revoked trust blocks repair but permits removal", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  await f.service.execute({ kind: "asset.install", coordinate: "a", placements: [f.placement] });
  const state = await new StateStore(f.home).read(), target = state.install.operations[0]!.resource.path;
  await rm(target); assert.equal((await f.service.doctor()).healthy, false);
  await f.service.execute({ kind: "repair", coordinate: "a" }); assert.equal((await f.service.doctor()).healthy, true);
  await rm(target); await symlink("/unknown/user/path", target);
  await assert.rejects(f.service.execute({ kind: "repair", coordinate: "a", overwriteOwned: true }), { code: "TARGET_MODIFIED" });
  await rm(target); await f.service.execute({ kind: "tap.untrust", name: "test/assets" });
  await assert.rejects(f.service.execute({ kind: "repair", coordinate: "a" }), { code: "SOURCE_UNTRUSTED" });
  await f.service.execute({ kind: "asset.remove", coordinate: "a" });
});

test("Bundle bindings are per checkout; detach survives missing manifest and preserves other binding", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  const manifest = { format: "harnessbrew.manifest", version: 1, id: "tools", sources: [{ name: "test/assets", git: f.repository }], assets: [{ coordinate: "test/assets/a", placements: [{ target: "openai-codex", scope: "project", project: "." }] }] };
  const file = path.join(f.project, "Harnessfile.yaml"); await writeFile(file, JSON.stringify(manifest));
  const preview = await f.service.plan({ kind: "bundle.apply", file });
  await writeFile(file, `${JSON.stringify(manifest)}\n`);
  await assert.rejects(f.service.apply(preview.planId), { code: "PLAN_STALE" });
  await f.service.execute({ kind: "bundle.apply", file });
  const checkout = path.join(f.root, "checkout"); await mkdir(checkout);
  const file2 = path.join(checkout, "Harnessfile.yaml"); await writeFile(file2, JSON.stringify(manifest));
  await writeFile(`${file2}.lock.json`, await readFile(`${file}.lock.json`));
  await f.service.execute({ kind: "bundle.apply", file: file2 });
  const state = await new StateStore(f.home).read(); assert.equal(state.install.owners.length, 2); assert.equal(state.install.operations.length, 2);
  await rm(file); await f.service.execute({ kind: "bundle.detach", binding: state.install.owners.find(o => o.directory === f.project)!.id });
  const after = await new StateStore(f.home).read(); assert.equal(after.install.owners.length, 1); assert.equal(after.install.operations.length, 1); assert.equal((await f.service.doctor()).healthy, true);
});

test("new Home preview does not initialize state; saved tap plan applies", async t => {
  const f = await applicationFixture(t); await f.add("a");
  const preview = await f.service.plan({ kind: "tap.add", name: "test/assets", url: f.repository });
  await assert.rejects(lstat(f.home), { code: "ENOENT" });
  await f.service.apply(preview.planId);
  assert.equal((await new StateStore(f.home).read()).sources.registrations[0]!.trusted, false);
  const second = createHarness(f.options); await second.close(); await assert.rejects(second.query({ kind: "list" }), { code: "INVALID_ARGUMENT" });
});

test("plugin add preview imports no code; saved apply detects drift before import; active adapters cannot be removed", async t => {
  const f = await applicationFixture(t), plugin = path.join(f.root, "plugin"), marker = path.join(f.root, "imported");
  await mkdir(plugin);
  await writeFile(path.join(plugin, "package.json"), JSON.stringify({ type: "module", harnessbrew: { format: "harnessbrew.adapter-package", version: 1, name: "test-adapter", adapterVersion: "1", entry: "index.mjs" } }));
  const code = `import { writeFileSync } from 'node:fs'; import path from 'node:path'; writeFileSync(${JSON.stringify(marker)}, 'loaded'); export default { protocol: 'harnessbrew.adapter/1', name: 'test-adapter', version: '1', supportedKinds: ['skill'], requiredCapabilities: ['link-directory'], async plan(asset, p) { return { operations: [{ type: 'link-directory', sourceRelativePath: 'assets', resource: { kind: 'path', path: path.join(p.roots.skills, 'a'), pathType: 'directory' } }] }; } };`;
  // Empty sourceRelativePath is invalid; use the inventoried references directory below.
  await writeFile(path.join(plugin, "index.mjs"), code.replace("sourceRelativePath: 'assets'", "sourceRelativePath: 'references'"));
  await f.add("a", { targets: ["test-adapter"] });
  const { git } = await import("./helpers/git.js");
  await mkdir(path.join(f.repository, "assets/a/references")); await writeFile(path.join(f.repository, "assets/a/references/info"), "test"); await git(f.repository, "add", "."); await git(f.repository, "commit", "-m", "references");
  await f.register();
  const request = { kind: "adapter.add" as const, module: plugin, capabilities: ["link-directory" as const] };
  const preview = await f.service.plan(request);
  await assert.rejects(lstat(marker), { code: "ENOENT" });
  await writeFile(path.join(plugin, "extra.txt"), "drift");
  await assert.rejects(f.service.apply(preview.planId), { code: "ADAPTER_CHANGED" });
  await assert.rejects(lstat(marker), { code: "ENOENT" });
  await rm(path.join(plugin, "extra.txt")); await f.service.apply(preview.planId);
  assert.equal(await readFile(marker, "utf8"), "loaded");
  await f.service.execute({ kind: "asset.install", coordinate: "a", placements: [{ ...f.placement, target: "test-adapter" }] });
  await assert.rejects(f.service.execute({ kind: "adapter.remove", name: "test-adapter" }), { code: "ADAPTER_IN_USE" });
  await writeFile(path.join(plugin, "extra.txt"), "drift again");
  // Releasing the final projection uses recorded ownership without importing drifted code.
  await f.service.execute({ kind: "asset.remove", coordinate: "a" });
  await f.service.execute({ kind: "adapter.remove", name: "test-adapter" });
});

test("shared repair preserves user text; cleanup refuses modified orphan content", async t => {
  const f = await applicationFixture(t); await f.add("a", { kind: "instruction" }); await f.register();
  await f.service.execute({ kind: "asset.install", coordinate: "a", placements: [f.placement] });
  const state = await new StateStore(f.home).read(), target = state.install.operations[0]!.resource.path;
  const original = await readFile(target, "utf8"); await writeFile(target, `# User text\n${original.replace('# a', '# Edited')}`);
  await assert.rejects(f.service.execute({ kind: "repair", coordinate: "a" }), { code: "TARGET_MODIFIED" });
  await f.service.execute({ kind: "repair", coordinate: "a", overwriteOwned: true });
  assert.equal(await readFile(target, "utf8"), `# User text\n${original}`);
  await f.service.execute({ kind: "asset.remove", coordinate: "a" });
  const content = path.join(f.home, "content", state.install.assets[0]!.contentDigest.slice(7), "content.md");
  await writeFile(content, "user edit");
  await assert.rejects(f.service.execute({ kind: "cleanup" }), { code: "CONTENT_MODIFIED" });
  assert.equal(await readFile(content, "utf8"), "user edit");
});

test("doctor reports damaged state and still diagnoses missing targets; unfinished transactions block preview", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  await f.service.execute({ kind: "asset.install", coordinate: "a", placements: [f.placement] });
  const store = new StateStore(f.home), state = await store.read();
  const { JournalStore } = await import("../src/transactions/journal.js");
  const journal = new JournalStore(f.home);
  await journal.save({ format: "harnessbrew.journal", version: 1, id: "pending", home: f.home, status: "prepared", beforeState: state, nextRevision: "next", steps: [] });
  const before = await readFile(journal.file);
  await assert.rejects(f.service.plan({ kind: "asset.remove", coordinate: "a" }), { code: "RECOVERY_REQUIRED" });
  await assert.rejects(f.service.query({ kind: "list" }), { code: "RECOVERY_REQUIRED" });
  assert.deepEqual(await readFile(journal.file), before);
  assert.equal((await f.service.doctor()).complete, false);
  await f.service.recover();
  await rm(state.install.operations[0]!.resource.path);
  const file = path.join(f.home, "revisions", `${state.revision}.json`), damaged = structuredClone(state);
  (damaged.install.assets as unknown[]).push({ coordinate: "test/assets/broken", contentDigest: "invalid" });
  await writeFile(file, JSON.stringify(damaged));
  const report = await f.service.doctor();
  assert.equal(report.healthy, false); assert.equal(report.complete, false);
  assert.ok(report.findings.some(f => f.category === "state")); assert.ok(report.findings.some(f => f.category === "target")); assert.ok(report.findings.some(f => f.category === "content"));
});

test("legacy Home and unrecognized SDK fields are rejected without modifying user files", async t => {
  const f = await applicationFixture(t); await mkdir(f.home); const file = path.join(f.home, "state.json"); await writeFile(file, "legacy");
  await assert.rejects(f.service.execute({ kind: "cleanup" }), { code: "UNSUPPORTED_FORMAT" });
  await assert.rejects(f.service.plan({ kind: "tap.add", name: "test/assets", url: f.repository, force: true } as unknown as ChangeRequest), { code: "INVALID_ARGUMENT" });
  assert.equal(await readFile(file, "utf8"), "legacy");
});

test("release works without source caches and preserves another required root", async t => {
  const f = await applicationFixture(t); await f.add("b"); await f.add("a", { dependencies: ["test/assets/b"] }); await f.register();
  for (const coordinate of ["a", "b"]) await f.service.execute({ kind: "asset.install", coordinate, placements: [f.placement] });
  const before = await new StateStore(f.home).read();
  for (const snapshot of before.sources.snapshots) await rm(snapshot.contentLocation, { recursive: true });
  const result = await f.service.execute({ kind: "asset.remove", coordinate: "b" });
  assert.equal(result.retained[0]!.coordinate, "test/assets/b"); assert.equal((await f.service.doctor()).healthy, true);
  await f.service.execute({ kind: "asset.remove", coordinate: "a" });
  assert.equal((await new StateStore(f.home).read()).install.operations.length, 0);
});
