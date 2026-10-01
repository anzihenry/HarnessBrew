import { assertNoConflicts, dependencyClosure } from "./graph.js";
import path from "node:path";
import { HarnessError } from "./errors.js";
import { absolutePath, commitId, contained, coordinate, digest, identifier, type CommitId, type Coordinate, type Digest } from "./identity.js";
import { owner, placement, placementId, requirementId, type Placement, type UsageOwner } from "./placement.js";
import { array, canonicalJson, format, invalid, oneOf, record, sortBy, text, unique } from "./validation.js";

export interface AssetPin { coordinate: Coordinate; commit: CommitId; contentDigest: Digest }
export interface UsageRequirement {
  id: string; ownerId: string; rootCoordinate: Coordinate; resolvedAssets: AssetPin[]; placements: Placement[];
}
export interface InstalledAsset extends AssetPin {
  snapshotId: string; dependencies: Coordinate[]; conflicts: Coordinate[]; operations: string[]; status: "active" | "orphan";
}
export type Resource = { kind: "path"; path: string; pathType: "file" | "directory" }
  | { kind: "block"; path: string; marker: string }
  | { kind: "config"; path: string; format: "json" | "toml"; keyPath: string[] };
export type Fingerprint = { kind: "file" | "directory"; digest: Digest } | { kind: "symlink"; target: string };
export type AppliedOperationType = "link-directory" | "link-file" | "write-file" | "write-block" | "set-config";
export interface AppliedOperation {
  id: string; asset: Coordinate; placementIds: string[]; resource: Resource; type: AppliedOperationType;
  installedFingerprint: Fingerprint; createdDirectories: string[]; requirementIds: string[];
}
export interface InstallState {
  format: "harnessbrew.install-state"; version: 1; revision: string;
  owners: UsageOwner[]; requirements: UsageRequirement[]; assets: InstalledAsset[]; operations: AppliedOperation[];
}
export function emptyInstallState(revision: string): InstallState {
  return { format: "harnessbrew.install-state", version: 1, revision: identifier(revision), owners: [], requirements: [], assets: [], operations: [] };
}
function strings(value: unknown, context: string): string[] {
  return unique(array(value, context, item => text(item, context)), item => item, context).sort();
}
function coordinates(value: unknown, context: string): Coordinate[] {
  return unique(array(value, context, coordinate), item => item, context).sort();
}
function pin(value: unknown): AssetPin {
  const item = record(value, "asset pin", ["coordinate", "commit", "contentDigest"]);
  return { coordinate: coordinate(item.coordinate), commit: commitId(item.commit), contentDigest: digest(item.contentDigest) };
}
function requirement(value: unknown): UsageRequirement {
  const item = record(value, "requirement", ["id", "ownerId", "rootCoordinate", "resolvedAssets", "placements"]);
  const root = coordinate(item.rootCoordinate);
  const ownerId = text(item.ownerId, "requirement owner");
  if (item.id !== requirementId(ownerId, root)) invalid("requirement identity");
  return { id: item.id as string, ownerId, rootCoordinate: root,
    resolvedAssets: sortBy(unique(array(item.resolvedAssets, "resolved assets", pin), asset => asset.coordinate, "pins"), asset => asset.coordinate),
    placements: sortBy(unique(array(item.placements, "placements", placement), placementId, "placements"), placementId) };
}
function installed(value: unknown): InstalledAsset {
  const item = record(value, "installed asset", ["coordinate", "commit", "contentDigest", "snapshotId", "dependencies", "conflicts", "operations", "status"]);
  return { ...pin({ coordinate: item.coordinate, commit: item.commit, contentDigest: item.contentDigest }),
    snapshotId: identifier(item.snapshotId), dependencies: coordinates(item.dependencies, "dependencies"),
    conflicts: coordinates(item.conflicts, "conflicts"), operations: strings(item.operations, "operation IDs"),
    status: oneOf(item.status, ["active", "orphan"] as const, "asset status") };
}
export function resource(value: unknown): Resource {
  const item = record(value, "resource", ["kind", "path", "pathType", "marker", "format", "keyPath"]);
  const destination = absolutePath(item.path);
  if (destination === path.parse(destination).root) invalid("root resource");
  if (item.kind === "path") {
    if (item.marker !== undefined || item.format !== undefined || item.keyPath !== undefined) invalid("path resource fields");
    return { kind: "path", path: destination, pathType: oneOf(item.pathType, ["file", "directory"] as const, "path type") };
  }
  if (item.kind === "block") {
    if (item.pathType !== undefined || item.format !== undefined || item.keyPath !== undefined) invalid("block resource fields");
    const marker = text(item.marker, "marker");
    if (/[\r\n]/u.test(marker) || marker.includes("-->")) invalid("marker");
    return { kind: "block", path: destination, marker };
  }
  if (item.kind !== "config" || item.pathType !== undefined || item.marker !== undefined) invalid("config resource fields");
  const keyPath = array(item.keyPath, "key path", value => text(value, "key"));
  if (!keyPath.length || keyPath.some(key => ["__proto__", "prototype", "constructor"].includes(key))) invalid("config key path");
  return { kind: "config", path: destination, format: oneOf(item.format, ["json", "toml"] as const, "config format"), keyPath };
}
export function resourcesConflict(left: Resource, right: Resource): boolean {
  if (left.path !== right.path) {
    return (left.kind === "path" && contained(left.path, right.path, false))
      || (right.kind === "path" && contained(right.path, left.path, false));
  }
  if (left.kind === "path" || right.kind === "path" || left.kind !== right.kind) return true;
  if (left.kind === "block" && right.kind === "block") return left.marker === right.marker;
  if (left.kind === "config" && right.kind === "config") {
    return left.format !== right.format || left.keyPath.slice(0, Math.min(left.keyPath.length, right.keyPath.length))
      .every((key, index) => key === right.keyPath[index]);
  }
  return false;
}
function operation(value: unknown): AppliedOperation {
  const item = record(value, "applied operation", ["id", "asset", "placementIds", "resource", "type", "installedFingerprint", "createdDirectories", "requirementIds"]);
  const type = oneOf(item.type, ["link-directory", "link-file", "write-file", "write-block", "set-config"] as const, "operation type");
  const target = resource(item.resource);
  const fingerprint = record(item.installedFingerprint, "fingerprint", ["kind", "digest", "target"]);
  const kind = oneOf(fingerprint.kind, ["file", "directory", "symlink"] as const, "fingerprint kind");
  const links = type === "link-directory" || type === "link-file";
  if (links !== (kind === "symlink")) invalid("operation fingerprint type");
  if (kind !== "symlink" && (fingerprint.target !== undefined || kind !== "file")) invalid("file fingerprint");
  if (kind === "symlink" && fingerprint.digest !== undefined) invalid("symlink fingerprint");
  if ((type === "write-block" && target.kind !== "block") || (type === "set-config" && target.kind !== "config")
    || ((links || type === "write-file") && (target.kind !== "path" || target.pathType !== (type === "link-directory" ? "directory" : "file")))) invalid("operation resource type");
  const createdDirectories = unique(array(item.createdDirectories, "created directories", absolutePath), item => item, "created directories");
  if (createdDirectories.some(dir => dir === path.parse(dir).root || !contained(dir, target.path, false))) invalid("created parent directory");
  return { id: identifier(item.id), asset: coordinate(item.asset), placementIds: unique(array(item.placementIds, "operation placements", identifier), value => value, "operation placements").sort(), resource: target, type,
    installedFingerprint: kind === "symlink" ? { kind, target: absolutePath(fingerprint.target) } : { kind, digest: digest(fingerprint.digest) },
    createdDirectories, requirementIds: strings(item.requirementIds, "operation requirements") };
}

export function parseInstallState(value: unknown): InstallState {
  const item = format(value, "harnessbrew.install-state", ["revision", "owners", "requirements", "assets", "operations"]);
  const state: InstallState = { format: "harnessbrew.install-state", version: 1, revision: identifier(item.revision),
    owners: unique(array(item.owners, "owners", owner), owner => owner.id, "owners"),
    requirements: unique(array(item.requirements, "requirements", requirement), item => item.id, "requirements"),
    assets: unique(array(item.assets, "assets", installed), item => item.coordinate, "assets"),
    operations: unique(array(item.operations, "operations", operation), item => item.id, "operations") };
  const owners = new Set(state.owners.map(item => item.id));
  const assets = new Map(state.assets.map(item => [item.coordinate, item]));
  const requirements = new Map(state.requirements.map(item => [item.id, item]));
  const operations = new Map(state.operations.map(item => [item.id, item]));
  const required = new Set<string>();
  for (const req of state.requirements) {
    if (!owners.has(req.ownerId)) invalid("requirement owner reference");
    const closure = new Set(dependencyClosure(req.rootCoordinate, name => {
      const asset = assets.get(name);
      return asset?.status === "active" ? asset : undefined;
    }).map(asset => asset.coordinate));
    if (req.resolvedAssets.length !== closure.size) invalid("requirement dependency closure");
    for (const selected of req.resolvedAssets) {
      const asset = assets.get(selected.coordinate);
      if (!asset || !closure.has(selected.coordinate)) invalid("requirement asset reference");
      if (selected.contentDigest !== asset.contentDigest || canonicalJson(selected.commit) !== canonicalJson(asset.commit)) {
        throw new HarnessError("VERSION_CONFLICT", `Conflicting requirement for ${selected.coordinate}.`);
      }
      required.add(selected.coordinate);
    }
  }
  for (const asset of state.assets) {
    if ((asset.status === "active") !== required.has(asset.coordinate)) invalid("asset activity and requirements");
    if (asset.status === "orphan" && asset.operations.length) invalid("orphan operations");
    for (const id of asset.operations) if (operations.get(id)?.asset !== asset.coordinate) invalid("asset operation reference");
  }
  assertNoConflicts(state.assets.filter(asset => asset.status === "active"));
  for (let i = 0; i < state.operations.length; i++) {
    const op = state.operations[i] as AppliedOperation;
    const asset = assets.get(op.asset);
    if (!asset || asset.status !== "active" || !asset.operations.includes(op.id) || !op.requirementIds.length) invalid("operation asset reference");
    const expectedRefs = state.requirements.filter(req => req.resolvedAssets.some(pin => pin.coordinate === op.asset)
      && req.placements.some(value => op.placementIds.includes(placementId(value)))).map(req => req.id).sort();
    if (!op.placementIds.length || op.placementIds.some(id => !state.requirements.some(req =>
      req.resolvedAssets.some(pin => pin.coordinate === op.asset) && req.placements.some(value => placementId(value) === id)))) {
      invalid("operation placement references");
    }
    if (canonicalJson(op.requirementIds) !== canonicalJson(expectedRefs)) invalid("operation requirement references");
    for (const id of op.requirementIds) if (!requirements.has(id)) invalid("operation requirement reference");
    for (const other of state.operations.slice(i + 1)) {
      if (resourcesConflict(op.resource, other.resource)) throw new HarnessError("OWNERSHIP_CONFLICT", `Overlapping resources: ${op.id}, ${other.id}`);
    }
  }
  for (const req of state.requirements) for (const pin of req.resolvedAssets) for (const target of req.placements) {
    if (!state.operations.some(op => op.asset === pin.coordinate && op.placementIds.includes(placementId(target)) && op.requirementIds.includes(req.id))) invalid("placement has no applied operations");
  }
  sortBy(state.owners, owner => owner.id);
  sortBy(state.requirements, req => req.id);
  sortBy(state.assets, asset => asset.coordinate);
  sortBy(state.operations, operation => operation.id);
  return state;
}
