import { registerContents } from "../src/domain/content.js";
import assert from "node:assert/strict";
import test from "node:test";
import { inventoryDigest, type ResolvedAsset } from "../src/domain/assets.js";
import type { CatalogSnapshot } from "../src/domain/catalog.js";
import { coordinate, hash } from "../src/domain/identity.js";
import { emptyHomeState, parseHomeState, type HomeState } from "../src/domain/home-state.js";
import { bundleOwner, placementId } from "../src/domain/placement.js";
import type { DesiredState } from "../src/domain/resolution.js";
import { parseBundleManifest } from "../src/domain/bundle.js";
import { resolveRequest } from "../src/resolution/resolve.js";

const A = coordinate("test/assets/a"), B = coordinate("test/assets/b"), C = coordinate("test/assets/c");
const target = { target: "codex", scope: "project" as const, projectRoot: "/project" };
function catalog(version = 1, definitions = [{ name: A, deps: [B], conflicts: [] as string[] }, { name: B, deps: [], conflicts: [] as string[] }]): CatalogSnapshot {
  const commit = { algorithm: "sha1" as const, value: String(version).repeat(40) };
  const snapshot = { id: `snapshot-${version}`, tap: "test/assets", url: "/source", commit, treeDigest: hash(`tree${version}`), contentLocation: `/cache/${version}` };
  const assets: ResolvedAsset[] = definitions.map(def => {
    const inventory = [{ path: "SKILL.md", type: "file" as const, digest: hash(`${def.name}${version}`), mode: 0o644 }];
    return { manifest: { coordinate: def.name, kind: "skill", entry: "SKILL.md", description: "test", dependencies: def.deps, conflicts: def.conflicts.map(coordinate), targets: ["codex"] }, snapshotId: snapshot.id, commit, inventory, contentDigest: inventoryDigest(inventory) };
  });
  return { assets, snapshots: [snapshot], selectedSnapshotIds: [snapshot.id] };
}
function stateFor(cat: CatalogSnapshot): HomeState {
  const state = emptyHomeState("revision-1");
  state.sources = { format: "harnessbrew.source-state", version: 1, snapshots: [...cat.snapshots], registrations: [{ name: "test/assets", url: "/source", trusted: true, selectedSnapshot: cat.selectedSnapshotIds[0]! }] };
  state.adapters.registrations = [{ name: "codex", module: "builtin:codex", protocol: "harnessbrew.adapter/1", version: "1", signature: hash("adapter"), capabilities: ["link-directory"] }];
  return state;
}
// Test-only state builder: no actual files are projected or executor behavior simulated.
function installed(state: HomeState, desired: DesiredState, cat: CatalogSnapshot): HomeState {
  const next = structuredClone(state);
  next.sources.snapshots = [...new Map([...next.sources.snapshots, ...cat.snapshots].map(s => [s.id, s])).values()];
  next.install.owners = structuredClone(desired.owners);
  next.install.requirements = structuredClone(desired.requirements);
  next.install.operations = [];
  next.install.assets = desired.assets.map(asset => {
    const operations: string[] = [];
    for (const [i, projection] of asset.placements.entries()) {
      const id = `op-${asset.coordinate.replaceAll("/", "-")}-${i}`;
      operations.push(id);
      next.install.operations.push({ id, asset: asset.coordinate, placementIds: [placementId(projection.placement)], type: "link-directory", resource: { kind: "path", path: `/target/${id}`, pathType: "directory" }, installedFingerprint: { kind: "symlink", target: `/cellar/${id}` }, createdDirectories: [], requirementIds: projection.requirementIds });
    }
    return { coordinate: asset.coordinate, commit: asset.commit, contentDigest: asset.contentDigest, snapshotId: asset.snapshotId, dependencies: asset.dependencies, conflicts: asset.conflicts, status: "active", operations };
  });
  next.contents = registerContents(next.contents, cat.assets, cat);
  return parseHomeState(next);
}
const manifest = () => parseBundleManifest({ format: "harnessbrew.manifest", version: 1, id: "tools", sources: [{ name: "test/assets", git: "/source" }], assets: [{ coordinate: A, placements: [] }] });
const combine = (old: CatalogSnapshot, fresh: CatalogSnapshot): CatalogSnapshot => ({ assets: [...old.assets, ...fresh.assets], snapshots: [...old.snapshots, ...fresh.snapshots], selectedSnapshotIds: fresh.selectedSnapshotIds });

test("install resolves dependency closure, inherits placements, stays pure and immutable", () => {
  const cat = catalog(), state = stateFor(cat), before = JSON.stringify({ state, cat });
  const result = resolveRequest(state, cat, { kind: "asset.install", coordinate: "a", placements: [target] });
  assert.deepEqual(result.assets.map(a => a.coordinate), [A, B]);
  assert.ok(result.assets.every(a => a.placements.length === 1));
  assert.equal(JSON.stringify({ state, cat }), before);
  assert.ok(Object.isFrozen(result.assets[0]!.placements));
  assert.deepEqual(result, resolveRequest(state, { ...cat, assets: [...cat.assets].reverse() }, { kind: "asset.install", coordinate: "a", placements: [target] }));
});

test("install reuses current version; upgrade adds new dependencies and preserves placement (A02)", () => {
  const old = catalog(), initial = stateFor(old);
  const state = installed(initial, resolveRequest(initial, old, { kind: "asset.install", coordinate: A, placements: [target] }), old);
  const fresh = catalog(2, [{ name: A, deps: [B, C], conflicts: [] }, { name: B, deps: [], conflicts: [] }, { name: C, deps: [], conflicts: [] }]);
  const cat = combine(old, fresh);
  assert.equal(resolveRequest(state, cat, { kind: "asset.install", coordinate: A }).assets.length, 2);
  const result = resolveRequest(state, cat, { kind: "asset.upgrade", coordinate: A });
  assert.equal(result.assets.length, 3);
  assert.ok(result.assets.every(a => a.commit.value === "2".repeat(40) && a.placements.length === 1));
});

test("upgrade rejects one-sided conflicts with a retained manual root (A03)", () => {
  const old = catalog(1, [{ name: A, deps: [], conflicts: [] }, { name: B, deps: [], conflicts: [] }]);
  let state = stateFor(old);
  state = installed(state, resolveRequest(state, old, { kind: "asset.install", coordinate: A }), old);
  state = installed(state, resolveRequest(state, old, { kind: "asset.install", coordinate: B }), old);
  const fresh = catalog(2, [{ name: A, deps: [], conflicts: [B] }, { name: B, deps: [], conflicts: [] }]);
  assert.throws(() => resolveRequest(state, combine(old, fresh), { kind: "asset.upgrade", coordinate: A }), { code: "ASSET_CONFLICT" });
});

test("shared manual dependency is upgraded consistently; remove retains shared assets", () => {
  const old = catalog(), initial = stateFor(old);
  let state = installed(initial, resolveRequest(initial, old, { kind: "asset.install", coordinate: A }), old);
  state = installed(state, resolveRequest(state, old, { kind: "asset.install", coordinate: B }), old);
  const result = resolveRequest(state, combine(old, catalog(2)), { kind: "asset.upgrade", coordinate: B });
  assert.ok(result.requirements.every(r => r.resolvedAssets.find(a => a.coordinate === B)!.commit.value === "2".repeat(40)));
  const removed = resolveRequest(state, old, { kind: "asset.remove", coordinate: B });
  assert.equal(removed.assets.length, 2);
  assert.deepEqual(removed.retained.map(a => a.coordinate), [B]);
  const removedA = resolveRequest(state, old, { kind: "asset.remove", coordinate: A });
  assert.deepEqual(removedA.orphanCoordinates, [A]);
});

test("Bundle pins block manual upgrade; detach preserves manual ownership", () => {
  const old = catalog(), initial = stateFor(old);
  let state = installed(initial, resolveRequest(initial, old, { kind: "asset.install", coordinate: A }), old);
  state = installed(state, resolveRequest(state, old, { kind: "bundle.apply", manifest: manifest(), directory: "/project" }), old);
  assert.throws(() => resolveRequest(state, combine(old, catalog(2)), { kind: "asset.upgrade", coordinate: A }), { code: "VERSION_CONFLICT" });
  const detached = resolveRequest(state, old, { kind: "bundle.detach", ownerId: bundleOwner("tools", "/project").id });
  assert.equal(detached.assets.length, 2);
  assert.ok(detached.requirements.every(r => r.ownerId === "manual"));
  assert.equal(detached.retained.length, 2);
});

test("lock replay ignores latest; explicit update changes pins; changed manifest fails", () => {
  const old = catalog(), state = stateFor(old);
  const first = resolveRequest(state, old, { kind: "bundle.apply", manifest: manifest(), directory: "/project" });
  const cat = combine(old, catalog(2));
  const locked = resolveRequest(state, cat, { kind: "bundle.apply", manifest: manifest(), directory: "/project", lock: first.bundleLock! });
  assert.deepEqual(locked.bundleLock, first.bundleLock);
  const updated = resolveRequest(state, cat, { kind: "bundle.apply", manifest: manifest(), directory: "/project", lock: first.bundleLock!, updateLock: true });
  assert.ok(updated.assets.every(a => a.commit.value === "2".repeat(40)));
  assert.throws(() => resolveRequest(state, cat, { kind: "bundle.apply", manifest: { ...manifest(), id: "changed" }, directory: "/project", lock: first.bundleLock! }), { code: "LOCK_MISMATCH" });
  const tampered = structuredClone(first.bundleLock!); tampered.assets[0]!.dependencies = [];
  assert.throws(() => resolveRequest(state, cat, { kind: "bundle.apply", manifest: manifest(), directory: "/project", lock: tampered }), { code: "LOCK_MISMATCH" });
});

test("separate Bundle directories are independent bindings; reapply replaces only one", () => {
  const cat = catalog(); let state = stateFor(cat);
  for (const directory of ["/one", "/two"]) state = installed(state, resolveRequest(state, cat, { kind: "bundle.apply", manifest: manifest(), directory }), cat);
  const result = resolveRequest(state, cat, { kind: "bundle.apply", manifest: { ...manifest(), assets: [] }, directory: "/one" });
  assert.equal(result.requirements.length, 1);
  assert.equal(result.requirements[0]!.ownerId, bundleOwner("tools", "/two").id);
  assert.equal(result.assets.length, 2);
});

test("untrusted Cellar allowed, activation blocked; existing placements survive trust revocation", () => {
  const cat = catalog(), initial = stateFor(cat);
  const state = installed(initial, resolveRequest(initial, cat, { kind: "asset.install", coordinate: A, placements: [target] }), cat);
  initial.sources.registrations[0]!.trusted = false;
  assert.equal(resolveRequest(initial, cat, { kind: "asset.install", coordinate: A }).assets.length, 2);
  assert.throws(() => resolveRequest(initial, cat, { kind: "asset.install", coordinate: A, placements: [target] }), { code: "SOURCE_UNTRUSTED" });
  state.sources.registrations[0]!.trusted = false;
  assert.equal(resolveRequest(state, cat, { kind: "asset.install", coordinate: A }).assets.length, 2);
  assert.equal(resolveRequest(state, cat, { kind: "placement.unlink", coordinate: A, placement: target }).assets[0]!.placements.length, 0);
});

test("missing dependencies, cycles, unsupported dependency targets and non-manual roots fail", () => {
  for (const [definitions, code] of [
    [[{ name: A, deps: [B], conflicts: [] }], "DEPENDENCY_MISSING"],
    [[{ name: A, deps: [B], conflicts: [] }, { name: B, deps: [A], conflicts: [] }], "DEPENDENCY_CYCLE"]
  ] as const) {
    const cat = catalog(1, definitions.map(d => ({ name: d.name, deps: [...d.deps], conflicts: [...d.conflicts] })));
    assert.throws(() => resolveRequest(stateFor(cat), cat, { kind: "asset.install", coordinate: A }), { code });
  }
  const cat = structuredClone(catalog()); cat.assets[1]!.manifest.targets = [];
  assert.throws(() => resolveRequest(stateFor(cat), cat, { kind: "asset.install", coordinate: A, placements: [target] }), { code: "TARGET_UNSUPPORTED" });
  const state = installed(stateFor(cat), resolveRequest(stateFor(cat), cat, { kind: "asset.install", coordinate: A }), cat);
  assert.throws(() => resolveRequest(state, cat, { kind: "asset.remove", coordinate: B }), { code: "NOT_MANUAL_ROOT" });
});

test("locked adapter signature changes are rejected", () => {
  const cat = catalog(), state = stateFor(cat), bundle = manifest();
  bundle.assets[0]!.placements = [{ target: "codex", scope: "project", project: "." }];
  const first = resolveRequest(state, cat, { kind: "bundle.apply", manifest: bundle, directory: "/project" });
  state.adapters.registrations[0]!.signature = hash("changed");
  assert.throws(() => resolveRequest(state, cat, { kind: "bundle.apply", manifest: bundle, directory: "/project", lock: first.bundleLock! }), { code: "ADAPTER_CHANGED" });
});

test("short names reject ambiguity and cross-Tap dependencies resolve by full coordinate", () => {
  const first = catalog(), second = structuredClone(catalog(2));
  const otherA = coordinate("other/assets/a"), otherB = coordinate("other/assets/b");
  second.snapshots[0]!.tap = "other/assets";
  for (const asset of second.assets) {
    asset.manifest.coordinate = asset.manifest.coordinate === A ? otherA : otherB;
    asset.manifest.dependencies = [];
  }
  first.assets[0]!.manifest.dependencies = [otherB];
  const cat = { assets: [...first.assets, ...second.assets], snapshots: [...first.snapshots, ...second.snapshots], selectedSnapshotIds: [...first.selectedSnapshotIds, ...second.selectedSnapshotIds] };
  const state = stateFor(cat);
  state.sources.registrations.push({ name: "other/assets", url: "/source", trusted: true, selectedSnapshot: "snapshot-2" });
  assert.throws(() => resolveRequest(state, cat, { kind: "asset.install", coordinate: "a" }), { code: "AMBIGUOUS_ASSET" });
  assert.deepEqual(resolveRequest(state, cat, { kind: "asset.install", coordinate: A }).assets.map(a => a.coordinate), [otherB, A]);
});

test("cleanup can use installed metadata without a catalog, and produces orphans", () => {
  const cat = catalog(), initial = stateFor(cat);
  const state = installed(initial, resolveRequest(initial, cat, { kind: "asset.install", coordinate: A, placements: [target] }), cat);
  const result = resolveRequest(state, { assets: [], snapshots: [], selectedSnapshotIds: [] }, { kind: "asset.remove", coordinate: A });
  assert.deepEqual(result.orphanCoordinates, [A, B]);
  assert.deepEqual(result.assets, []);
});

test("Bundle source declarations cannot replace registered URLs or grant trust", () => {
  const cat = catalog(), state = stateFor(cat), bundle = manifest();
  bundle.sources.push({ name: "unused/tap", git: "/new" });
  state.sources.registrations.push({ name: "unused/tap", url: "/original", trusted: false });
  assert.throws(() => resolveRequest(state, cat, { kind: "bundle.apply", manifest: bundle, directory: "/project" }), { code: "SOURCE_MISMATCH" });
  state.sources.registrations = [];
  const cellar = resolveRequest(state, cat, { kind: "bundle.apply", manifest: manifest(), directory: "/project" });
  assert.equal(cellar.requiredSources.length, 1);
  const placed = manifest(); placed.assets[0]!.placements = [{ target: "codex", scope: "project" }];
  assert.throws(() => resolveRequest(state, cat, { kind: "bundle.apply", manifest: placed, directory: "/project" }), { code: "SOURCE_UNTRUSTED" });
});

test("malformed requests fail with structured validation errors", () => {
  const cat = catalog(), state = stateFor(cat);
  for (const request of [{ kind: "asset.install" }, { kind: "asset.install", coordinate: A, placements: {} }, { kind: "asset.upgrade", force: true }]) {
    assert.throws(() => resolveRequest(state, cat, request as never), error => error instanceof Error && "code" in error && ["INVALID_ARGUMENT", "INVALID_STATE"].includes(String(error.code)));
  }
});
