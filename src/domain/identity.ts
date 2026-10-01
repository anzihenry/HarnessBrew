import { createHash } from "node:crypto";
import path from "node:path";
import { HarnessError } from "./errors.js";
import { canonicalJson, invalid, record, text } from "./validation.js";

export type Coordinate = string & { readonly __coordinate: unique symbol };
export type Digest = `sha256:${string}`;
export interface CommitId { algorithm: "sha1" | "sha256"; value: string }
const segment = "[a-z0-9][a-z0-9-]*";
export function coordinate(value: unknown): Coordinate {
  if (typeof value !== "string" || !new RegExp(`^${segment}/${segment}/${segment}$`, "u").test(value)) invalid("asset coordinate");
  return value as Coordinate;
}
export function tapName(value: unknown): string {
  if (typeof value !== "string" || !new RegExp(`^${segment}/${segment}$`, "u").test(value)) invalid("tap name");
  return value;
}
export function identifier(value: unknown): string {
  if (typeof value !== "string" || !new RegExp(`^${segment}$`, "u").test(value)) invalid("identifier");
  return value;
}
export function digest(value: unknown): Digest {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) invalid("digest");
  return value as Digest;
}
export function hash(value: string | Uint8Array): Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
export function stableId(value: unknown): string { return hash(canonicalJson(value)).slice(7); }
export function commitId(value: unknown): CommitId {
  const item = record(value, "commit", ["algorithm", "value"]);
  if (item.algorithm !== "sha1" && item.algorithm !== "sha256") invalid("Git object format");
  const size = item.algorithm === "sha1" ? 40 : 64;
  if (typeof item.value !== "string" || !new RegExp(`^[a-f0-9]{${size}}$`, "u").test(item.value)) invalid("Git commit ID");
  return { algorithm: item.algorithm, value: item.value };
}
export function relativePath(value: unknown): string {
  const result = text(value, "relative asset path");
  if (path.isAbsolute(result) || /^[a-z]:/iu.test(result) || result.includes("\\")
    || result.split("/").some(part => part === "" || part === "." || part === "..")) invalid("relative asset path");
  return result;
}
export function absolutePath(value: unknown): string {
  const result = text(value, "absolute path");
  if (!path.isAbsolute(result)) invalid("absolute path");
  return path.resolve(result);
}
export function contained(root: string, candidate: string, allowRoot = true): boolean {
  const relative = path.relative(root, candidate);
  return (allowRoot || relative !== "") && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export function resolveAsset<T extends { coordinate: Coordinate }>(assets: readonly T[], query: string): T {
  const matches = assets.filter(asset => query.includes("/") ? asset.coordinate === coordinate(query) : asset.coordinate.split("/").at(-1) === query);
  if (!matches.length) throw new HarnessError("ASSET_NOT_FOUND", `Asset not found: ${query}`, { query });
  if (matches.length > 1) throw new HarnessError("AMBIGUOUS_ASSET", `Asset name is ambiguous: ${query}`, {
    query, candidates: matches.map(asset => asset.coordinate).sort()
  });
  return matches[0] as T;
}
