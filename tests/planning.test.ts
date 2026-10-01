import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import type { AdapterOperation, AssetReader, TargetAdapter } from "../src/domain/adapter.js";
import { inventoryDigest, type ResolvedAsset, type AssetKind } from "../src/domain/assets.js";
import type { CatalogSnapshot } from "../src/domain/catalog.js";
import { emptyHomeState, parseHomeState, type HomeState } from "../src/domain/home-state.js";
import { coordinate, hash } from "../src/domain/identity.js";
import type { ChangePlan, PlanningIO, TargetSnapshot } from "../src/domain/plan.js";
import type { DesiredState } from "../src/domain/resolution.js";
import type { Placement } from "../src/domain/placement.js";
import { AdapterRegistry } from "../src/adapters/registry.js";
import { resolveRequest } from "../src/resolution/resolve.js";
import { planChange } from "../src/planning/plan.js";
import { nodePlanningIO } from "../src/ports/planning.js";
import { readConfig } from "../src/planning/config.js";

const A = coordinate("test/assets/a"), B = coordinate("test/assets/b");
const placement: Placement = { target: "openai-codex", scope: "project", projectRoot: "/project" };
function fixture(kind: AssetKind = "instruction", count = 1) {
  const snapshot = { id: "snapshot-1", tap: "test/assets", url: "/source", commit: { algorithm: "sha1" as const, value: "a".repeat(40) }, treeDigest: hash("tree"), contentLocation: "/cache" };
  const bodies = new Map<string, string>();
  const assets: ResolvedAsset[] = [A, B].slice(0, count).map(name => {
    const content = kind === "mcp" ? '{"transport":"stdio","command":"tool","args":[],"envVars":["TOKEN"]}' : kind === "skill" ? `---\nname: ${name.split("/").at(-1)}\ndescription: test\n---\n# Content\n` : `# ${name}\n`;
    bodies.set(name, content);
    const inventory = [{ path: "SKILL.md", type: "file" as const, digest: hash(content), mode: 0o644 }];
    return { manifest: { coordinate: name, kind, entry: "SKILL.md", description: "Test asset", dependencies: [], conflicts: [], targets: ["openai-codex", "plugin"] }, commit: snapshot.commit, snapshotId: snapshot.id, inventory, contentDigest: inventoryDigest(inventory) };
  });
  const catalog: CatalogSnapshot = { assets, snapshots: [snapshot], selectedSnapshotIds: [snapshot.id] };
  const state = emptyHomeState("rev-1");
  state.sources = { format: "harnessbrew.source-state", version: 1, registrations: [{ name: snapshot.tap, url: snapshot.url, trusted: true, selectedSnapshot: snapshot.id }], snapshots: [snapshot] };
  state.adapters.registrations.push({ name: "openai-codex", module: "builtin:codex", version: "1", protocol: "harnessbrew.adapter/1", signature: hash("codex"), capabilities: ["link-directory", "link-file", "write-file", "write-block", "set-config"] });
  const registry = new AdapterRegistry(); registry.registerCodex(hash("codex"));
  const files = new Map<string, TargetSnapshot>();
  const identity = (name: string) => ({ physicalPath: name, ancestor: { path: path.dirname(name), realPath: path.dirname(name), device: "1", inode: "1" } });
  const io: PlanningIO = { identify: async name => identity(name), inspect: async name => files.get(name) ?? { path: name, identity: identity(name), kind: "missing" } };
  const reader: AssetReader = { readAsset: async asset => Buffer.from(bodies.get(asset.manifest.coordinate)!) };
  function desired(current = state, target: Placement = placement): DesiredState { return resolveRequest(current, catalog, { kind: "asset.install", coordinate: A, placements: [target] }); }
  async function plan(result = desired(), current = state): Promise<ChangePlan> { return planChange({ state: current, desired: result, catalog, adapters: registry, io, assets: reader, home: "/home/hb", userHome: "/user", requestDigest: hash("request") }); }
  function applyForTest(plan: ChangePlan): HomeState {
    for (const update of plan.fileUpdates) files.set(update.path, { path: update.path, identity: identity(update.path), ...update.after });
    const next = structuredClone(state);
    next.install.owners = structuredClone(plan.desiredState.owners); next.install.requirements = structuredClone(plan.desiredState.requirements);
    next.install.operations = plan.expectedOperations.map(op => ({ id: op.id, asset: op.asset, type: op.operation.type, resource: op.operation.resource, placementIds: op.placementIds, requirementIds: op.requirementIds, installedFingerprint: op.installedFingerprint, createdDirectories: [] as string[] })).concat(plan.retainedOperations);
    next.install.assets = plan.desiredState.assets.map(asset => ({ coordinate: asset.coordinate, commit: asset.commit, contentDigest: asset.contentDigest, snapshotId: asset.snapshotId, dependencies: asset.dependencies, conflicts: asset.conflicts, status: "active", operations: next.install.operations.filter(op => op.asset === asset.coordinate).map(op => op.id) }));
    return parseHomeState(next);
  }
  return { state, catalog, bodies, registry, io, reader, files, identity, desired, plan, applyForTest };
}

for (const kind of ["skill", "agent", "workflow", "prompt", "instruction", "mcp"] as const) {
  test(`Codex ${kind}: deterministic plan, no writes, repeated apply is empty`, async () => {
    const f = fixture(kind), desired = f.desired(), before = JSON.stringify({ state: f.state, desired });
    const first = await f.plan(desired);
    assert.equal(first.fileUpdates.length, 1);
    assert.equal(f.files.size, 0);
    assert.equal(JSON.stringify({ state: f.state, desired }), before);
    assert.ok(Object.isFrozen(first.operations[0]));
    assert.deepEqual(await f.plan(desired), first);
    const installed = f.applyForTest(first);
    const repeated = await f.plan(f.desired(installed), installed);
    assert.equal(repeated.operations.length, 0); assert.equal(repeated.fileUpdates.length, 0); assert.equal(repeated.assetChanges.length, 0);
  });
}

test("two assets edit one shared file, preserve user config and remove only owned keys", async () => {
  const f = fixture("mcp", 2); f.catalog.assets[0]!.manifest.dependencies.push(B);
  f.files.set("/project/.codex/config.toml", { path: "/project/.codex/config.toml", identity: f.identity("/project/.codex/config.toml"), kind: "file", mode: 0o600, content: '# User setting\nmodel = "user"\n[mcp_servers.user]\ncommand = "user-tool"\n' });
  const plan = await f.plan();
  assert.equal(plan.operations.length, 2); assert.equal(plan.fileUpdates.length, 1);
  assert.equal(plan.operations[0]!.asset, B); assert.ok(plan.operations[1]!.dependsOn.includes(plan.operations[0]!.id));
  const after = plan.fileUpdates[0]!.after; assert.equal(after.kind, "file");
  if (after.kind === "file") { assert.ok(after.content.includes("# User setting")); assert.equal(readConfig(after.content, "toml", ["mcp_servers", "user", "command"]), "user-tool"); }
  const installed = f.applyForTest(plan);
  const desired = resolveRequest(installed, f.catalog, { kind: "asset.remove", coordinate: A });
  const removal = await f.plan(desired, installed);
  assert.equal(removal.operations[0]!.asset, A); assert.equal(removal.operations[1]!.asset, B);
  assert.equal(removal.fileUpdates.length, 1); assert.equal(removal.assetChanges.filter(a => a.type === "orphan").length, 2);
  const removed = removal.fileUpdates[0]!.after;
  if (removed.kind === "file") { assert.equal(readConfig(removed.content, "toml", ["mcp_servers", "a"]), undefined); assert.equal(readConfig(removed.content, "toml", ["model"]), "user"); }
});

test("shared owners retain the same physical operation without writes", async () => {
  const f = fixture(); let state = f.applyForTest(await f.plan());
  const manifest = { format: "harnessbrew.manifest" as const, version: 1 as const, id: "tools", sources: [{ name: "test/assets", git: "/source" }], assets: [{ coordinate: A, placements: [{ target: "openai-codex", scope: "project" as const, project: "." }] }] };
  const shared = await f.plan(resolveRequest(state, f.catalog, { kind: "bundle.apply", manifest, directory: "/project" }), state);
  assert.equal(shared.fileUpdates.length, 0); assert.equal(shared.expectedOperations[0]!.requirementIds.length, 2);
  state = f.applyForTest(shared);
  const released = await f.plan(resolveRequest(state, f.catalog, { kind: "asset.remove", coordinate: A }), state);
  assert.equal(released.fileUpdates.length, 0); assert.equal(released.expectedOperations[0]!.requirementIds.length, 1);
});

test("unowned target, changed content and changed mode fail closed", async () => {
  const f = fixture("agent"), first = await f.plan(), state = f.applyForTest(first), destination = first.fileUpdates[0]!.path;
  await assert.rejects(f.plan(), { code: "OWNERSHIP_CONFLICT" });
  const file = f.files.get(destination)!; assert.equal(file.kind, "file");
  if (file.kind === "file") file.mode = 0o600;
  await assert.rejects(f.plan(f.desired(state), state), { code: "TARGET_MODIFIED" });
  if (file.kind === "file") { file.mode = 0o644; file.content += "user edit"; }
  await assert.rejects(f.plan(f.desired(state), state), { code: "TARGET_MODIFIED" });
});

function plugin(operations: (root: string) => AdapterOperation[]): TargetAdapter {
  return { protocol: "harnessbrew.adapter/1", name: "plugin", version: "1", supportedKinds: ["instruction"], requiredCapabilities: ["link-file"], async plan(_asset, target) { return { operations: operations(target.roots.config) }; } };
}
function register(f: ReturnType<typeof fixture>, adapter: TargetAdapter): void {
  f.registry.registerPlugin(adapter, hash("plugin"), ["link-file"]);
  f.state.adapters.registrations.push({ name: "plugin", module: "/plugin", protocol: "harnessbrew.adapter/1", version: "1", signature: hash("plugin"), capabilities: ["link-file"] });
}
const link = (destination: string): AdapterOperation => ({ type: "link-file", resource: { kind: "path", path: destination, pathType: "file" }, sourceRelativePath: "SKILL.md" });
test("third-party adapter can return multiple operations within an authorized root", async () => {
  const f = fixture(); register(f, plugin(root => [link(path.join(root, "one")), link(path.join(root, "two"))]));
  const result = await f.plan(f.desired(f.state, { target: "plugin", scope: "user" }));
  assert.equal(result.fileUpdates.length, 2); assert.ok(result.fileUpdates.every(file => file.path.startsWith("/user/.plugin/")));
});

test("operation validator rejects escaped paths, wrong source and unauthorized payloads", async () => {
  for (const operations of [() => [link("/outside/file")], (root: string) => [{ ...link(path.join(root, "one")), sourceRelativePath: "../escape" }], (root: string) => [{ type: "write-file" as const, resource: { kind: "path" as const, path: path.join(root, "one"), pathType: "file" as const }, content: "bad", mode: 0o644 }]]) {
    const f = fixture(); register(f, plugin(operations));
    await assert.rejects(f.plan(f.desired(f.state, { target: "plugin", scope: "user" })), error => error instanceof Error && "code" in error);
  }
  const f = fixture(); assert.throws(() => f.registry.registerPlugin(plugin(() => []), hash("p"), ["write-file"]), { code: "CAPABILITY_DENIED" });
});

test("adapter instances do not share registrations; mismatched signatures fail", async () => {
  const f = fixture(); register(f, plugin(root => [link(path.join(root, "one"))]));
  assert.throws(() => new AdapterRegistry().get("plugin"), { code: "TARGET_UNSUPPORTED" });
  f.state.adapters.registrations[0]!.signature = hash("changed");
  await assert.rejects(f.plan(), { code: "ADAPTER_CHANGED" });
});

test("same physical projection from two placements merges; two assets cannot own it", async () => {
  const f = fixture(); register(f, plugin(root => [link(path.join(root, "one"))]));
  const desired = resolveRequest(f.state, f.catalog, { kind: "asset.install", coordinate: A, placements: [{ target: "plugin", scope: "user", rootOverride: "/same" }, { target: "plugin", scope: "project", projectRoot: "/project", rootOverride: "/same" }] });
  const plan = await f.plan(desired); assert.equal(plan.expectedOperations.length, 1); assert.equal(plan.expectedOperations[0]!.placementIds.length, 2);
  const g = fixture("instruction", 2); register(g, plugin(root => [link(path.join(root, "one"))])); g.catalog.assets[0]!.manifest.dependencies.push(B);
  await assert.rejects(g.plan(g.desired(g.state, { target: "plugin", scope: "user" })), { code: "OWNERSHIP_CONFLICT" });
});

test("asset view catches changed bytes before rendering", async () => {
  const f = fixture(); f.bodies.set(A, "changed");
  await assert.rejects(f.plan(), { code: "CONTENT_MODIFIED" });
});

test("planning with real path aliases is read-only and captures physical parent preconditions", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hb-plan-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "actual")); await symlink(path.join(root, "actual"), path.join(root, "alias"));
  const f = fixture(); register(f, plugin(target => [link(path.join(target, "one"))]));
  const desired = resolveRequest(f.state, f.catalog, { kind: "asset.install", coordinate: A, placements: [{ target: "plugin", scope: "user", rootOverride: path.join(root, "actual") }, { target: "plugin", scope: "user", rootOverride: path.join(root, "alias") }] });
  const plan = await planChange({ state: f.state, desired, catalog: f.catalog, adapters: f.registry, io: nodePlanningIO, assets: f.reader, home: path.join(root, "home"), userHome: root, requestDigest: hash("request") });
  assert.equal(plan.expectedOperations.length, 1); assert.equal(plan.expectedOperations[0]!.placementIds.length, 2);
  assert.ok(plan.preconditions.some(p => p.path.includes("/alias/") && p.identity.physicalPath.includes("/actual/")));
  await assert.rejects(readFile(path.join(root, "actual/one")), { code: "ENOENT" });
});

test("user scope uses user roots; explicit root override controls all Codex destinations", async () => {
  for (const kind of ["skill", "agent", "instruction", "mcp"] as const) {
    const f = fixture(kind);
    const user = await f.plan(f.desired(f.state, { target: "openai-codex", scope: "user" }));
    assert.ok(user.fileUpdates[0]!.path.startsWith("/user/."));
    const overridden = await f.plan(f.desired(f.state, { target: "openai-codex", scope: "user", rootOverride: "/custom" }));
    assert.ok(overridden.fileUpdates[0]!.path.startsWith("/custom/"));
  }
});

test("stale revision, target bytes, permissions, parent identity and plan tampering fail", async () => {
  const { assertPlanFresh } = await import("../src/planning/preconditions.js");
  const f = fixture(), plan = await f.plan();
  const context = { revision: f.state.revision, home: "/home/hb", io: f.io, adapters: f.registry };
  await assertPlanFresh(plan, context);
  await assert.rejects(assertPlanFresh(plan, { ...context, revision: "changed" }), { code: "PLAN_STALE" });
  const tampered = structuredClone(plan); tampered.operations = [];
  await assert.rejects(assertPlanFresh(tampered, context), { code: "INVALID_PLAN" });
  const destination = plan.fileUpdates[0]!.path;
  f.files.set(destination, { kind: "file", path: destination, identity: f.identity(destination), content: "external write", mode: 0o644 });
  await assert.rejects(assertPlanFresh(plan, context), { code: "PLAN_STALE" });
  f.files.delete(destination);
  const aliasedIO: PlanningIO = { ...f.io, inspect: async name => ({ ...(await f.io.inspect(name)), identity: { ...f.identity(name), ancestor: { ...f.identity(name).ancestor, inode: "changed" } } }) };
  await assert.rejects(assertPlanFresh(plan, { ...context, io: aliasedIO }), { code: "PLAN_STALE" });
});

test("removing missing shared targets never creates empty files", async () => {
  const f = fixture("mcp"), state = f.applyForTest(await f.plan()); f.files.clear();
  const plan = await f.plan(resolveRequest(state, f.catalog, { kind: "asset.remove", coordinate: A }), state);
  assert.equal(plan.fileUpdates.length, 0); assert.equal(plan.operations.length, 1);
});

test("source unavailable or trust revoked permits unchanged ownership and release", async () => {
  const f = fixture(), state = f.applyForTest(await f.plan()); state.sources.registrations[0]!.trusted = false;
  const repeated = await f.plan(f.desired(state), state);
  assert.equal(repeated.fileUpdates.length, 0); assert.equal(repeated.retainedOperations.length, 1);
  const empty: CatalogSnapshot = { assets: [], snapshots: [], selectedSnapshotIds: [] };
  const desired = resolveRequest(state, empty, { kind: "asset.remove", coordinate: A });
  const removal = await planChange({ state, desired, catalog: empty, adapters: new AdapterRegistry(), io: f.io, assets: f.reader, home: "/home/hb", userHome: "/user", requestDigest: hash("remove") });
  assert.equal(removal.fileUpdates.length, 1); assert.equal(removal.operations[0]!.type, "remove-owned");
});

test("changed versions with equal rendered content update metadata without target writes", async () => {
  const f = fixture(), state = f.applyForTest(await f.plan());
  const next = structuredClone(f.catalog); next.snapshots[0]!.id = "snapshot-2"; next.snapshots[0]!.commit.value = "b".repeat(40);
  next.assets[0]!.snapshotId = "snapshot-2"; next.assets[0]!.commit.value = "b".repeat(40);
  const catalog = { ...next, selectedSnapshotIds: ["snapshot-2"] };
  const desired = resolveRequest(state, catalog, { kind: "asset.upgrade", coordinate: A });
  const plan = await planChange({ state, desired, catalog, adapters: f.registry, io: f.io, assets: f.reader, home: "/home/hb", userHome: "/user", requestDigest: hash("upgrade") });
  assert.equal(plan.assetChanges[0]!.type, "update"); assert.equal(plan.fileUpdates.length, 0);
});

test("malformed DesiredState cannot bypass committed ownership invariants", async () => {
  const f = fixture(); const desired = structuredClone(f.desired()); desired.requirements[0]!.resolvedAssets = [];
  await assert.rejects(f.plan(desired), { code: "INVALID_STATE" });
});

test("symlink children escaping an authorized root and dangling parents are rejected", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hb-plan-escape-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "target")); await mkdir(path.join(root, "outside"));
  await symlink(path.join(root, "outside"), path.join(root, "target/child"));
  const f = fixture(); register(f, plugin(target => [link(path.join(target, "child/file"))]));
  const desired = f.desired(f.state, { target: "plugin", scope: "user", rootOverride: path.join(root, "target") });
  await assert.rejects(planChange({ state: f.state, desired, catalog: f.catalog, adapters: f.registry, io: nodePlanningIO, assets: f.reader, home: path.join(root, "home"), userHome: root, requestDigest: hash("request") }), { code: "INVALID_PLAN" });
  await symlink(path.join(root, "missing"), path.join(root, "dangling"));
  await assert.rejects(nodePlanningIO.inspect(path.join(root, "dangling/file")), { code: "INVALID_PLAN" });
});

test("inventory-backed asset access rejects symlinks, mode drift and undeclared files", async t => {
  const { catalogAssetReader } = await import("../src/ports/planning.js");
  const { assetView } = await import("../src/planning/assets.js");
  const { chmod } = await import("node:fs/promises");
  const root = await mkdtemp(path.join(os.tmpdir(), "hb-plan-source-")); t.after(() => rm(root, { recursive: true, force: true }));
  const f = fixture(), snapshot = f.catalog.snapshots[0]!; snapshot.contentLocation = root;
  await mkdir(path.join(root, "assets/a"), { recursive: true });
  const entry = path.join(root, "assets/a/SKILL.md"); await writeFile(entry, f.bodies.get(A)!); await chmod(entry, 0o644);
  const view = assetView(f.catalog.assets[0]!, catalogAssetReader(f.catalog));
  assert.equal(await view.readText("SKILL.md"), f.bodies.get(A));
  await assert.rejects(view.readText("secret.txt"), { code: "INVALID_PLAN" });
  await chmod(entry, 0o755); await assert.rejects(view.readText("SKILL.md"), { code: "CONTENT_MODIFIED" });
  await rm(entry); await writeFile(path.join(root, "outside"), f.bodies.get(A)!); await symlink(path.join(root, "outside"), entry);
  await assert.rejects(view.readText("SKILL.md"), { code: "CONTENT_MODIFIED" });
});

test("Adapter destinations cannot overlap Home metadata or content storage", async () => {
  const f = fixture(); register(f, plugin(root => [link(path.join(root, "record"))]));
  await assert.rejects(f.plan(f.desired(f.state, { target: "plugin", scope: "user", rootOverride: "/home/hb" })), { code: "INVALID_PLAN" });
});
