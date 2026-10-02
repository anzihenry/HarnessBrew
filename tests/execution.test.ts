import test from "node:test";
import assert from "node:assert/strict";
import { lstat, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { TransactionCoordinator } from "../src/transactions/coordinator.js";
import { JournalStore } from "../src/transactions/journal.js";
import { fixture, A } from "./helpers/execution.js";
import { nodePlanningIO } from "../src/ports/planning.js";
import { precondition } from "../src/planning/resources.js";
import { bundleOwner } from "../src/domain/placement.js";

for (const kind of ["skill", "agent", "workflow", "prompt", "instruction", "mcp"] as const) test(`Executor installs, verifies and releases ${kind}`, async t => {
  const f = await fixture(kind, 2); t.after(() => rm(f.root, { recursive: true, force: true }));
  const coordinator = new TransactionCoordinator(f.home, { lockRoot: f.lockRoot });
  const result = await coordinator.apply(await f.plan());
  const current = await coordinator.read();
  assert.equal(current.revision, result.committedRevision); assert.equal(current.install.assets.length, 2); assert.equal(current.install.operations.length, 2);
  for (const asset of current.install.assets) assert.ok((await lstat(path.join(f.home, "content", asset.contentDigest.slice(7), "SKILL.md"))).isFile());
  const again = await coordinator.apply(await f.plan(current)); assert.equal(again.committedRevision, current.revision); assert.deepEqual(again.changes, []);
  const released = await coordinator.apply(await f.plan(current, { kind: "asset.remove", coordinate: A }));
  assert.ok(released.committedRevision !== current.revision);
  const after = await coordinator.read(); assert.equal(after.install.operations.length, 0); assert.ok(after.install.assets.every(a => a.status === "orphan"));
  assert.equal(await new JournalStore(f.home).load(), undefined);
});

test("recorded target failure restores prior state and existing dependency links (A05)", async t => {
  const f = await fixture("skill", 2); t.after(() => rm(f.root, { recursive: true, force: true }));
  const normal = new TransactionCoordinator(f.home, { lockRoot: f.lockRoot });
  await normal.apply(await f.plan(f.state, { kind: "asset.install", coordinate: "test/assets/b", placements: [{ target: "openai-codex", scope: "project", projectRoot: f.project }] }));
  const before = await normal.read(), b = before.install.operations[0]!.resource.path, link = await readlink(b);
  const broken = new TransactionCoordinator(f.home, { lockRoot: f.lockRoot, fault(point, context) { if (point === "after-record" && context.path?.endsWith("/skills/a")) throw new Error("injected"); } });
  await assert.rejects(broken.apply(await f.plan(before)), /injected/);
  assert.deepEqual(await normal.read(), before); assert.equal(await readlink(b), link);
  await assert.rejects(lstat(path.join(f.project, ".agents/skills/a")), { code: "ENOENT" });
});

test("failure after state publication restores old CURRENT and resources", async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const coordinator = new TransactionCoordinator(f.home, { lockRoot: f.lockRoot, fault(point) { if (point === "after-state") throw new Error("after-state failure"); } });
  await assert.rejects(coordinator.apply(await f.plan()), /after-state failure/);
  assert.deepEqual(await f.store.read(), f.state);
  await assert.rejects(lstat(path.join(f.project, ".agents/skills/a")), { code: "ENOENT" });
});

test("unrecorded writes fail recovery closed and preserve both errors", async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const input = await f.plan();
  const coordinator = new TransactionCoordinator(f.home, { lockRoot: f.lockRoot, fault(point, context) { if (point === "after-write" && context.path?.endsWith("/skills/a")) throw new Error("unrecorded"); } });
  await assert.rejects(coordinator.apply(input), error => error instanceof Error && "code" in error && error.code === "RECOVERY_REQUIRED" && error.cause instanceof AggregateError && error.cause.errors.length === 2);
  const journal = await new JournalStore(f.home).load(); assert.equal(journal?.status, "recovery-required");
  assert.ok((await lstat(path.join(f.project, ".agents/skills/a"))).isSymbolicLink());
  await assert.rejects(coordinator.read(), { code: "RECOVERY_REQUIRED" });
  await assert.rejects(f.store.commit(f.state.revision, f.state), { code: "RECOVERY_REQUIRED" });
});

test("committed cleanup failure returns success and recovery only completes cleanup", async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const coordinator = new TransactionCoordinator(f.home, { lockRoot: f.lockRoot, fault(point) { if (point === "before-cleanup") throw new Error("cleanup"); } });
  const result = await coordinator.apply(await f.plan()); assert.equal(result.diagnostics.length, 1);
  assert.equal((await f.store.read()).revision, result.committedRevision);
  const normal = new TransactionCoordinator(f.home, { lockRoot: f.lockRoot }); await normal.recover();
  assert.equal((await normal.read()).revision, result.committedRevision);
});

test("Bundle lockfile and requirements roll back together, then can commit and detach", async t => {
  const f = await fixture("mcp"); t.after(() => rm(f.root, { recursive: true, force: true }));
  const lockPath = path.join(f.project, "harnessbrew.lock.json"); await writeFile(lockPath, "original\n");
  const request = { kind: "bundle.apply" as const, manifest: { format: "harnessbrew.manifest" as const, version: 1 as const, id: "tools", sources: [{ name: "test/assets", git: f.catalog.snapshots[0]!.url }], assets: [{ coordinate: A, placements: [{ target: "openai-codex", scope: "project" as const }] }] }, directory: f.project };
  const input = { ...await f.plan(f.state, request), bundleLock: { path: lockPath, before: precondition(await nodePlanningIO.inspect(lockPath)) } };
  const broken = new TransactionCoordinator(f.home, { lockRoot: f.lockRoot, fault(point) { if (point === "before-state") throw new Error("fail bundle"); } });
  await assert.rejects(broken.apply(input), /fail bundle/);
  assert.equal(await readFile(lockPath, "utf8"), "original\n"); assert.deepEqual(await f.store.read(), f.state);
  const normal = new TransactionCoordinator(f.home, { lockRoot: f.lockRoot });
  await normal.apply(input); assert.equal(JSON.parse(await readFile(lockPath, "utf8")).format, "harnessbrew.lock");
  await normal.apply(await f.plan(await normal.read(), { kind: "bundle.detach", ownerId: bundleOwner("tools", f.project).id }));
  assert.equal((await normal.read()).install.operations.length, 0);
});

test("external changes during rollback are preserved", async t => {
  const f = await fixture("agent"); t.after(() => rm(f.root, { recursive: true, force: true }));
  const input = await f.plan(), target = input.plan.fileUpdates[0]!.path;
  const coordinator = new TransactionCoordinator(f.home, { lockRoot: f.lockRoot, async fault(point) { if (point === "before-state") { await writeFile(target, "user edit\n"); throw new Error("failure"); } } });
  await assert.rejects(coordinator.apply(input), { code: "RECOVERY_REQUIRED" });
  assert.equal(await readFile(target, "utf8"), "user edit\n");
});

test("nested session helpers reuse Home locks; stale plans fail before writes", async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const coordinator = new TransactionCoordinator(f.home, { lockRoot: f.lockRoot });
  const stale = await f.plan();
  await coordinator.withSession(async session => {
    assert.deepEqual(await coordinator.read(), await session.read());
    await coordinator.execute(state => f.plan(state));
  });
  await assert.rejects(coordinator.apply(stale), { code: "PLAN_STALE" });
});

test("modified or missing installed content is never silently repaired", async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const coordinator = new TransactionCoordinator(f.home, { lockRoot: f.lockRoot });
  await coordinator.apply(await f.plan()); const state = await coordinator.read();
  const content = path.join(f.home, "content", state.install.assets[0]!.contentDigest.slice(7));
  await writeFile(path.join(content, "SKILL.md"), "user edit");
  await assert.rejects(coordinator.apply(await f.plan(state)), { code: "CONTENT_MODIFIED" });
  await rm(content, { recursive: true });
  await assert.rejects(coordinator.apply(await f.plan(state)), { code: "CONTENT_MODIFIED" });
  assert.deepEqual(await coordinator.read(), state);
});

test("Executor rejects a rehashed file payload that differs from the logical operations", async t => {
  const { stableId } = await import("../src/domain/identity.js");
  const f = await fixture("agent"); t.after(() => rm(f.root, { recursive: true, force: true }));
  const input = await f.plan(); const changed = structuredClone(input.plan);
  if (changed.fileUpdates[0]!.after.kind === "file") changed.fileUpdates[0]!.after.content = "unvalidated payload";
  const { id: _id, ...data } = changed; changed.id = stableId(data);
  await assert.rejects(new TransactionCoordinator(f.home, { lockRoot: f.lockRoot }).apply({ ...input, plan: changed }), { code: "INVALID_PLAN" });
  assert.equal(await new JournalStore(f.home).load(), undefined); assert.deepEqual(await f.store.read(), f.state);
});

test("state snapshot publication failure rolls back already-written targets", async t => {
  const { StateStore } = await import("../src/storage/state-store.js");
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const store = new StateStore(f.home, { fault(point) { if (point === "before-publish") throw new Error("state publish failure"); } });
  const coordinator = new TransactionCoordinator(f.home, { lockRoot: f.lockRoot, store });
  await assert.rejects(coordinator.apply(await f.plan()), /state publish failure/);
  assert.deepEqual(await f.store.read(), f.state);
  await assert.rejects(lstat(path.join(f.project, ".agents/skills/a")), { code: "ENOENT" });
});

test("external Bundle lock modification during rollback is not overwritten", async t => {
  const f = await fixture("mcp"); t.after(() => rm(f.root, { recursive: true, force: true }));
  const lock = path.join(f.project, "lock.json"); await writeFile(lock, "old\n");
  const request = { kind: "bundle.apply" as const, directory: f.project, manifest: { format: "harnessbrew.manifest" as const, version: 1 as const, id: "bundle", sources: [{ name: "test/assets", git: f.catalog.snapshots[0]!.url }], assets: [{ coordinate: A, placements: [] }] } };
  const input = { ...await f.plan(f.state, request), bundleLock: { path: lock, before: precondition(await nodePlanningIO.inspect(lock)) } };
  const coordinator = new TransactionCoordinator(f.home, { lockRoot: f.lockRoot, async fault(point) { if (point === "before-state") { await writeFile(lock, "external\n"); throw new Error("lock changed"); } } });
  await assert.rejects(coordinator.apply(input), { code: "RECOVERY_REQUIRED" }); assert.equal(await readFile(lock, "utf8"), "external\n");
});

test("parent replacement immediately before a target write cannot redirect it", async t => {
  const { rename, symlink } = await import("node:fs/promises");
  const f = await fixture("agent"); t.after(() => rm(f.root, { recursive: true, force: true }));
  const input = await f.plan(), destination = input.plan.fileUpdates[0]!.path, parent = path.dirname(destination), outside = path.join(f.root, "outside");
  await mkdir(outside);
  const coordinator = new TransactionCoordinator(f.home, { lockRoot: f.lockRoot, async fault(point, context) {
    if (point === "before-write" && context.path === destination) { await rename(parent, `${parent}-original`); await symlink(outside, parent); }
  } });
  await assert.rejects(coordinator.apply(input), { code: "RECOVERY_REQUIRED" });
  await assert.rejects(lstat(path.join(outside, path.basename(destination))), { code: "ENOENT" });
});

test("modified historical state is not trusted when restoring CURRENT", async t => {
  const f = await fixture(); t.after(() => rm(f.root, { recursive: true, force: true }));
  const coordinator = new TransactionCoordinator(f.home, { lockRoot: f.lockRoot, async fault(point) {
    if (point === "after-state") {
      const previous = structuredClone(f.state); previous.sources.registrations[0]!.trusted = false;
      await writeFile(path.join(f.home, "revisions", `${f.state.revision}.json`), JSON.stringify(previous));
      throw new Error("historical state changed");
    }
  } });
  await assert.rejects(coordinator.apply(await f.plan()), { code: "RECOVERY_REQUIRED" });
  assert.notEqual((await f.store.read()).revision, f.state.revision);
  assert.equal((await new JournalStore(f.home).load())?.status, "recovery-required");
});
