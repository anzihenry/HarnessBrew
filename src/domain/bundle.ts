import path from "node:path";
import { commitId, coordinate, digest, hash, identifier, tapName, type CommitId, type Coordinate, type Digest } from "./identity.js";
import { type AssetPin } from "./state.js";
import { array, canonicalJson, format, invalid, oneOf, record, sortBy, text, unique } from "./validation.js";

export interface BundlePlacement { target: string; scope: "user" | "project"; project?: string; root?: string }
export interface BundleRoot { coordinate: Coordinate; placements: BundlePlacement[] }
export interface BundleSource { name: string; git: string; ref?: string }
export interface BundleManifest {
  format: "harnessbrew.manifest"; version: 1; id: string; sources: BundleSource[]; assets: BundleRoot[];
}
export interface AdapterSignature { name: string; version: string; signature: Digest }
export interface BundleLockedAsset extends AssetPin { dependencies: Coordinate[] }
export interface BundleLock {
  format: "harnessbrew.lock"; version: 1; manifestDigest: Digest;
  sources: { name: string; url: string; commits: CommitId[] }[];
  assets: BundleLockedAsset[];
  roots: BundleRoot[];
  adapterSignatures: AdapterSignature[];
}
function portablePath(value: unknown): string {
  const result = text(value, "portable path");
  if (path.posix.isAbsolute(result) || path.win32.isAbsolute(result) || /^[a-z]:/iu.test(result) || result.includes("\\")) invalid("portable path");
  return path.posix.normalize(result).replace(/\/$/u, "") || ".";
}
export function bundlePlacement(value: unknown): BundlePlacement {
  const item = record(value, "bundle placement", ["target", "scope", "project", "root"]);
  const scope = oneOf(item.scope, ["user", "project"] as const, "bundle scope");
  if (scope === "user" && item.project !== undefined) invalid("user placement project");
  return { target: identifier(item.target), scope,
    ...(scope === "project" ? { project: portablePath(item.project ?? ".") } : {}),
    ...(item.root === undefined ? {} : { root: portablePath(item.root) }) };
}
function roots(value: unknown): BundleRoot[] {
  return sortBy(unique(array(value, "bundle roots", raw => {
    const item = record(raw, "bundle root", ["coordinate", "placements"]);
    const placements = sortBy(unique(array(item.placements, "bundle placements", bundlePlacement), canonicalJson, "bundle placements"), canonicalJson);
    return { coordinate: coordinate(item.coordinate), placements };
  }), root => root.coordinate, "bundle roots"), root => root.coordinate);
}
export function parseBundleManifest(value: unknown): BundleManifest {
  const item = format(value, "harnessbrew.manifest", ["id", "sources", "assets"]);
  const sources = sortBy(unique(array(item.sources, "bundle sources", raw => {
    const source = record(raw, "bundle source", ["name", "git", "ref"]);
    return { name: tapName(source.name), git: text(source.git, "Git URL"), ...(source.ref === undefined ? {} : { ref: text(source.ref, "Git ref") }) };
  }), source => source.name, "bundle sources"), source => source.name);
  return { format: "harnessbrew.manifest", version: 1, id: identifier(item.id), sources, assets: roots(item.assets) };
}
export function bundleManifestDigest(manifest: BundleManifest): Digest { return hash(canonicalJson(parseBundleManifest(manifest))); }
export function parseBundleLock(value: unknown): BundleLock {
  const item = format(value, "harnessbrew.lock", ["manifestDigest", "sources", "assets", "roots", "adapterSignatures"]);
  const sources = sortBy(unique(array(item.sources, "locked sources", raw => {
    const source = record(raw, "locked source", ["name", "url", "commits"]);
    return { name: tapName(source.name), url: text(source.url, "locked source URL"),
      commits: sortBy(unique(array(source.commits, "locked commits", commitId), canonicalJson, "locked commits"), canonicalJson) };
  }), source => source.name, "locked sources"), source => source.name);
  const assets = sortBy(unique(array(item.assets, "locked assets", raw => {
    const asset = record(raw, "locked asset", ["coordinate", "commit", "contentDigest", "dependencies"]);
    return { coordinate: coordinate(asset.coordinate), commit: commitId(asset.commit), contentDigest: digest(asset.contentDigest),
      dependencies: unique(array(asset.dependencies, "locked dependencies", coordinate), name => name, "locked dependencies").sort() };
  }), asset => asset.coordinate, "locked assets"), asset => asset.coordinate);
  const adapterSignatures = sortBy(unique(array(item.adapterSignatures, "locked adapters", raw => {
    const adapter = record(raw, "locked adapter", ["name", "version", "signature"]);
    return { name: identifier(adapter.name), version: text(adapter.version, "adapter version"), signature: digest(adapter.signature) };
  }), adapter => adapter.name, "locked adapters"), adapter => adapter.name);
  return { format: "harnessbrew.lock", version: 1, manifestDigest: digest(item.manifestDigest), sources, assets, roots: roots(item.roots), adapterSignatures };
}
