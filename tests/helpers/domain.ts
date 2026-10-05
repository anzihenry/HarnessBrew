import { inventoryDigest } from "../../src/domain/assets.js";
import { coordinate, hash, type Coordinate } from "../../src/domain/identity.js";
import { bundleOwner, placementId, requirementId, type UsageOwner } from "../../src/domain/placement.js";
import { type InstalledAsset, type UsageRequirement } from "../../src/domain/state.js";
import { emptyHomeState, type HomeState } from "../../src/domain/home-state.js";

export const A = coordinate("test/assets/a");
export const B = coordinate("test/assets/b");
export const C = coordinate("test/assets/c");
export const commit = { algorithm: "sha1" as const, value: "a".repeat(40) };
export const projectPlacement = { target: "openai-codex", scope: "project" as const, projectRoot: "/workspace/project" };

export function installedAsset(name: Coordinate, dependencies: Coordinate[] = []): InstalledAsset {
  return { coordinate: name, commit: { ...commit }, contentDigest: inventoryDigest([{ path: "SKILL.md", type: "file", digest: hash(name), mode: 0o644 }]), snapshotId: "snapshot-1",
    dependencies, conflicts: [], operations: [], status: "active" };
}
export function fixtureState(withPlacement = false): HomeState {
  const state = emptyHomeState("revision-1");
  state.sources.registrations.push({ name: "test/assets", url: "https://example.com/assets.git", trusted: true, selectedSnapshot: "snapshot-1" });
  state.sources.snapshots.push({ id: "snapshot-1", tap: "test/assets", url: "https://example.com/assets.git", commit: { ...commit }, treeDigest: hash("tree"), contentLocation: "/cache/snapshot-1" });
  state.adapters.registrations.push({ name: "openai-codex", module: "builtin:codex", protocol: "harnessbrew.adapter/1", version: "1", signature: hash("adapter"), capabilities: ["link-directory"] });
  state.install.owners.push({ id: "manual", kind: "manual" });
  state.install.assets.push(installedAsset(A, [B]), installedAsset(B));
  for (const name of [A, B, C]) state.contents.push({ digest: installedAsset(name).contentDigest, inventory: [{ path: "SKILL.md", type: "file", digest: hash(name), mode: 0o644 }], origins: [{ coordinate: name, snapshot: state.sources.snapshots[0]! }] });
  const req = addRequirement(state, { id: "manual", kind: "manual" }, A);
  if (withPlacement) {
    req.placements.push(projectPlacement);
    for (const asset of state.install.assets) {
      const id = `operation-${asset.coordinate.split("/").at(-1)}`;
      asset.operations.push(id);
      state.install.operations.push({ id, asset: asset.coordinate, placementIds: [placementId(projectPlacement)], type: "link-directory",
        resource: { kind: "path", path: `/workspace/project/.agents/skills/${asset.coordinate.split("/").at(-1)}`, pathType: "directory" },
        installedFingerprint: { kind: "symlink", target: `/content/${asset.contentDigest.slice(7)}` }, createdDirectories: [], requirementIds: [req.id] });
    }
  }
  return state;
}
export function addRequirement(state: HomeState, owner: UsageOwner, root: Coordinate): UsageRequirement {
  if (!state.install.owners.some(value => value.id === owner.id)) state.install.owners.push(owner);
  const req: UsageRequirement = { id: requirementId(owner.id, root), ownerId: owner.id, rootCoordinate: root,
    resolvedAssets: state.install.assets.map(asset => ({ coordinate: asset.coordinate, commit: { ...asset.commit }, contentDigest: asset.contentDigest })), placements: [] };
  state.install.requirements.push(req);
  return req;
}
export function sharedState(): HomeState {
  const state = fixtureState(true);
  const req = addRequirement(state, bundleOwner("tools", "/workspace/project"), A);
  req.placements.push(projectPlacement);
  for (const op of state.install.operations) op.requirementIds.push(req.id);
  return state;
}
