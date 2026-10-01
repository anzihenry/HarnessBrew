import path from "node:path";
import { absolutePath, identifier, stableId } from "./identity.js";
import { invalid, oneOf, record } from "./validation.js";

export interface Placement {
  target: string;
  scope: "user" | "project";
  projectRoot?: string;
  rootOverride?: string;
}
/** Lexical normalization only. The executor must also verify physical parent paths. */
export function placement(value: unknown): Placement {
  const item = record(value, "placement", ["target", "scope", "projectRoot", "rootOverride"]);
  const scope = oneOf(item.scope, ["user", "project"] as const, "scope");
  if (scope === "user" && item.projectRoot !== undefined) invalid("user placement projectRoot");
  return {
    target: identifier(item.target), scope,
    ...(scope === "project" ? { projectRoot: absolutePath(item.projectRoot) } : {}),
    ...(item.rootOverride === undefined ? {} : { rootOverride: absolutePath(item.rootOverride) })
  };
}
export function placementId(value: Placement): string { return stableId(placement(value)); }
export interface UsageOwner {
  id: string;
  kind: "manual" | "bundle";
  manifestId?: string;
  directory?: string;
}
export function bundleOwner(manifestId: string, directory: string): UsageOwner {
  const name = identifier(manifestId);
  const root = absolutePath(directory);
  return { id: `bundle:${name}@${stableId(root)}`, kind: "bundle", manifestId: name, directory: root };
}
export function owner(value: unknown): UsageOwner {
  const item = record(value, "owner", ["id", "kind", "manifestId", "directory"]);
  if (item.kind === "manual") {
    if (item.id !== "manual" || item.manifestId !== undefined || item.directory !== undefined) invalid("manual owner");
    return { id: "manual", kind: "manual" };
  }
  if (item.kind !== "bundle") invalid("owner kind");
  const expected = bundleOwner(identifier(item.manifestId), absolutePath(item.directory));
  if (item.id !== expected.id) invalid("bundle binding identity");
  return expected;
}
export function requirementId(ownerId: string, rootCoordinate: string): string {
  return stableId({ ownerId, rootCoordinate });
}
export function resolvePlacement(input: {
  target: string; scope: "user" | "project"; project?: string; root?: string;
}, baseDirectory: string): Placement {
  const base = absolutePath(baseDirectory);
  return placement({ target: input.target, scope: input.scope,
    ...(input.project === undefined ? {} : { projectRoot: path.resolve(base, input.project) }),
    ...(input.root === undefined ? {} : { rootOverride: path.resolve(base, input.root) }) });
}
