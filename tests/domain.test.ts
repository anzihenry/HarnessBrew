import assert from "node:assert/strict";
import test from "node:test";
import { manifest, inventory, inventoryDigest, resolvedAsset } from "../src/domain/assets.js";
import { commitId, coordinate, hash, relativePath, resolveAsset } from "../src/domain/identity.js";
import { bundleOwner, placement, placementId } from "../src/domain/placement.js";
import { parseInstallState } from "../src/domain/state.js";
import { parseHomeState } from "../src/domain/home-state.js";
import { A, B, C, commit, fixtureState, installedAsset, sharedState } from "./helpers/domain.js";

const code = (value: string) => ({ code: value });
test("asset identities reject traversal and normalize declarations without losing Git object format", () => {
  for (const value of ["../assets/a", "test/assets/a/b", "Test/assets/a"]) assert.throws(() => coordinate(value));
  for (const value of ["../secret", "a/../b", "/absolute", "a\\..\\b", "C:/secret", "a//b", "."]) assert.throws(() => relativePath(value));
  assert.equal(commitId({ algorithm: "sha256", value: "f".repeat(64) }).algorithm, "sha256");
  assert.throws(() => commitId({ algorithm: "sha1", value: "f".repeat(64) }));
  const value = manifest({ coordinate: A, kind: "skill", entry: "SKILL.md", description: "A", dependencies: [C, B, B], conflicts: [], targets: ["codex", "codex"] });
  assert.deepEqual(value.dependencies, [B, C]);
  assert.deepEqual(value.targets, ["codex"]);
});
test("short names use one ambiguity rule with deterministic candidate coordinates", () => {
  const values = [{ coordinate: A }, { coordinate: coordinate("other/assets/a") }];
  assert.throws(() => resolveAsset(values, "a"), error => {
    assert.equal((error as { code: string }).code, "AMBIGUOUS_ASSET");
    assert.deepEqual((error as { details: { candidates: string[] } }).details.candidates, ["other/assets/a", A]);
    return true;
  });
  assert.equal(resolveAsset(values, A).coordinate, A);
  assert.throws(() => resolveAsset(values, "missing"), code("ASSET_NOT_FOUND"));
});
test("placements and bundle bindings normalize lexical aliases and distinguish checkout roots", () => {
  const left = placement({ target: "codex", scope: "project", projectRoot: "/work/a/../b/" });
  const right = placement({ target: "codex", scope: "project", projectRoot: "/work/b" });
  assert.equal(placementId(left), placementId(right));
  assert.throws(() => placement({ target: "codex", scope: "project" }));
  assert.throws(() => placement({ target: "codex", scope: "user", projectRoot: "/work" }));
  assert.equal(bundleOwner("tools", "/work/a/../b").id, bundleOwner("tools", "/work/b").id);
  assert.notEqual(bundleOwner("tools", "/work/b").id, bundleOwner("tools", "/work/c").id);
});
test("inventory validates directory parents, modes, duplicate paths and supported file types", () => {
  const entries = [{ path: "scripts", type: "directory", mode: 0o755 }, { path: "scripts/run", type: "file", mode: 0o755, digest: hash("run") }];
  assert.equal(inventory(entries).length, 2);
  for (const value of [[entries[1]], [...entries, entries[1]], [{ path: "link", type: "symlink", mode: 0o777 }], [{ path: "file", type: "file", mode: -1, digest: hash("x") }]]) assert.throws(() => inventory(value));
  assert.throws(() => resolvedAsset({ manifest: { coordinate: A, kind: "skill", entry: "SKILL.md", description: "A", dependencies: [], conflicts: [], targets: [] }, snapshotId: "snapshot-1", commit, contentDigest: hash("x"), inventory: entries }), /entry absent/u);
});
test("state preserves shared requirements while rejecting dangling and inconsistent references", () => {
  const shared = parseHomeState(sharedState());
  assert.equal(shared.install.operations.length, 2);
  assert.equal(shared.install.operations[0]?.requirementIds.length, 2);
  const detached = structuredClone(shared);
  const bundle = detached.install.requirements.find(req => req.ownerId !== "manual")!;
  detached.install.requirements = detached.install.requirements.filter(req => req !== bundle);
  detached.install.owners = detached.install.owners.filter(owner => owner.id === "manual");
  detached.install.operations.forEach(op => { op.requirementIds = op.requirementIds.filter(id => id !== bundle.id); });
  assert.equal(parseHomeState(detached).install.operations.length, 2);
  for (const mutate of [
    (s: ReturnType<typeof fixtureState>) => { s.install.owners = []; },
    (s: ReturnType<typeof fixtureState>) => { s.install.assets[0]!.operations = []; },
    (s: ReturnType<typeof fixtureState>) => { s.install.operations[0]!.requirementIds = []; },
    (s: ReturnType<typeof fixtureState>) => { s.install.assets[0]!.status = "orphan"; },
    (s: ReturnType<typeof fixtureState>) => { s.sources.snapshots = []; },
    (s: ReturnType<typeof fixtureState>) => { s.adapters.registrations = []; }
  ]) { const bad = fixtureState(true); mutate(bad); assert.throws(() => parseHomeState(bad)); }
});
test("committed state cannot hide missing dependencies, cycles, conflicts or different pinned versions", () => {
  const missing = fixtureState(); missing.install.assets.pop();
  assert.throws(() => parseHomeState(missing), code("DEPENDENCY_MISSING"));
  const cycle = fixtureState(); cycle.install.assets[1]!.dependencies = [A];
  assert.throws(() => parseHomeState(cycle), code("DEPENDENCY_CYCLE"));
  const conflict = fixtureState(); conflict.install.assets[1]!.conflicts = [A];
  assert.throws(() => parseHomeState(conflict), code("ASSET_CONFLICT"));
  const version = fixtureState(); version.install.requirements[0]!.resolvedAssets[0]!.contentDigest = hash("other");
  assert.throws(() => parseHomeState(version), code("VERSION_CONFLICT"));
  const orphan = fixtureState(); const extra = installedAsset(C); extra.status = "orphan"; orphan.install.assets.push(extra);
  assert.equal(parseHomeState(orphan).install.assets.length, 3);
});
test("resource ownership rejects overlapping paths, mixed shared strategies and config ancestor keys", () => {
  const state = fixtureState(true);
  const [left, right] = state.install.operations;
  assert.ok(left && right);
  right.resource.path = `${left.resource.path}/child`;
  assert.throws(() => parseHomeState(state), code("OWNERSHIP_CONFLICT"));
  state.adapters.registrations[0]!.capabilities = ["set-config"];
  for (const op of state.install.operations) {
    op.type = "set-config"; op.resource = { kind: "config", path: "/target/config.toml", format: "toml", keyPath: ["mcp", op.id] };
    op.installedFingerprint = { kind: "file", digest: hash(op.id) };
  }
  assert.equal(parseHomeState(state).install.operations.length, 2);
  left.resource = { kind: "config", path: "/target/config.toml", format: "toml", keyPath: ["mcp"] };
  assert.throws(() => parseHomeState(state), code("OWNERSHIP_CONFLICT"));
  left.resource = { kind: "config", path: "/target/config.toml", format: "toml", keyPath: ["__proto__"] };
  assert.throws(() => parseHomeState(state), code("INVALID_STATE"));
});
test("old formats, unknown versions and legacy duplicate fields are rejected", () => {
  assert.throws(() => parseInstallState({ schemaVersion: 2, links: [] }), code("UNSUPPORTED_FORMAT"));
  assert.throws(() => parseHomeState({ ...fixtureState(), version: 2 }), code("UNSUPPORTED_FORMAT"));
  assert.throws(() => parseInstallState({ ...fixtureState().install, links: [] }), code("INVALID_STATE"));
});

test("one physical operation can retain requirements from distinct placement identities", () => {
  const state = sharedState();
  const bundle = state.install.requirements.find(req => req.ownerId !== "manual")!;
  bundle.placements[0] = { target: "openai-codex", scope: "user", rootOverride: "/workspace/project/.agents" };
  for (const operation of state.install.operations) operation.placementIds.push(placementId(bundle.placements[0]!));
  const parsed = parseHomeState(state);
  assert.equal(parsed.install.operations[0]?.placementIds.length, 2);
  const invalid = structuredClone(parsed);
  invalid.install.operations[0]!.placementIds.push("unknown-placement");
  assert.throws(() => parseHomeState(invalid), { code: "INVALID_STATE" });
});


test("content identity includes file modes and empty directories in a stable inventory order", () => {
  const files = inventory([{ path: "SKILL.md", type: "file", mode: 0o644, digest: hash("body") }, { path: "empty", type: "directory", mode: 0o755 }]);
  const contentDigest = inventoryDigest(files);
  assert.equal(inventoryDigest([...files].reverse()), contentDigest);
  assert.notEqual(inventoryDigest(files.filter(entry => entry.type === "file")), contentDigest);
  assert.notEqual(inventoryDigest(files.map(entry => ({ ...entry, mode: 0o700 }))), contentDigest);
  const asset = { manifest: { coordinate: A, kind: "skill", entry: "SKILL.md", description: "A", dependencies: [], conflicts: [], targets: [] }, snapshotId: "snapshot-1", commit, contentDigest, inventory: files };
  assert.equal(resolvedAsset(asset).contentDigest, contentDigest);
  assert.throws(() => resolvedAsset({ ...asset, contentDigest: hash("incorrect") }), /inventory digest/u);
});
