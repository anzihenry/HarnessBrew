import { HarnessError } from "../domain/errors.js";
import { absolutePath, commitId, coordinate, digest, identifier } from "../domain/identity.js";
import { array, canonicalJson, record, text } from "../domain/validation.js";
import { sourceSnapshot, resolvedAsset } from "../domain/assets.js";
import { parseContents } from "../domain/content.js";
import { parseBundleLock } from "../domain/bundle.js";
import { owner, placement } from "../domain/placement.js";
import { resource } from "../domain/state.js";

type Check = (value: unknown) => unknown;
const str: Check = v => text(v, "prepared string");
const bool: Check = v => { if (typeof v !== "boolean") throw new Error("Expected boolean"); };
const num: Check = v => { if (!Number.isSafeInteger(v) || (v as number) < 0) throw new Error("Expected nonnegative integer"); };
const list = (check: Check): Check => v => array(v, "prepared array", check);
const strings = list(str);
const literal = (...values: unknown[]): Check => v => { if (!values.includes(v)) throw new Error("Unexpected value"); };
const object = (fields: Record<string, Check>): Check => v => {
  const parsed = record(v, "prepared object", Object.keys(fields).map(k => k.replace(/\?$/, "")));
  for (const [field, check] of Object.entries(fields)) {
    const key = field.replace(/\?$/, "");
    if (parsed[key] === undefined && field.endsWith("?")) continue;
    check(parsed[key]);
  }
};
const union = (tag: string, choices: Record<string, Check>): Check => v => {
  if (!v || typeof v !== "object" || !Object.hasOwn(choices, String((v as Record<string, unknown>)[tag]))) throw new Error("Unknown variant");
  choices[String((v as Record<string, unknown>)[tag])]!(v);
};
const fileText: Check = v => { if (typeof v !== "string") throw new Error("Expected file text"); };
export const pathIdentity = object({ physicalPath: absolutePath, ancestor: object({ path: absolutePath, realPath: absolutePath, device: str, inode: str }) });
const fingerprint = union("kind", {
  missing: object({ kind: literal("missing") }), other: object({ kind: literal("other") }),
  symlink: object({ kind: literal("symlink"), target: str }),
  file: object({ kind: literal("file"), digest }), directory: object({ kind: literal("directory"), digest })
});
export const fileImage = union("kind", {
  missing: object({ kind: literal("missing") }), symlink: object({ kind: literal("symlink"), target: str }),
  file: object({ kind: literal("file"), bytes: fileText, mode: num }),
  directory: object({ kind: literal("directory"), device: fileText, inode: fileText, mode: num }),
  content: object({ kind: literal("content"), digest, device: fileText, inode: fileText })
});
export const resourcePrecondition = object({ path: absolutePath, identity: pathIdentity, fingerprint, "mode?": num });
const operationType = literal("link-directory", "link-file", "write-file", "write-block", "set-config");
const operation = union("type", {
  "link-directory": object({ type: literal("link-directory"), resource, sourceRelativePath: str }),
  "link-file": object({ type: literal("link-file"), resource, sourceRelativePath: str }),
  "write-file": object({ type: literal("write-file"), resource, content: fileText, mode: num }),
  "write-block": object({ type: literal("write-block"), resource, content: fileText, blockFormat: literal("html-comment") }),
  "set-config": object({ type: literal("set-config"), resource, value: canonicalJson })
});
const pin = { coordinate, commit: commitId, contentDigest: digest };
const requirement = object({ id: str, ownerId: str, rootCoordinate: coordinate, resolvedAssets: list(object(pin)), placements: list(placement) });
const after = union("kind", { missing: object({ kind: literal("missing") }), symlink: object({ kind: literal("symlink"), target: str }), file: object({ kind: literal("file"), content: fileText, mode: num }) });
const signature = object({ name: str, version: str, signature: digest });
export const catalogData = object({ snapshots: list(sourceSnapshot), selectedSnapshotIds: strings, assets: list(resolvedAsset) });
export const contentChanges = list(object({ digest, action: literal("restore", "reclaim", "forget-missing"), path: absolutePath, bytes: num, affectedAssets: list(coordinate), "commit?": commitId, "quarantine?": absolutePath }));
export const restorations = list(object({ digest, staged: absolutePath, before: fileImage, bytes: num }));
export const stagedContents = list(object({ digest, staged: absolutePath }));
export const contentChecks = list(object({ path: absolutePath, before: fileImage }));
export const lockUpdates = list(object({ path: absolutePath, before: resourcePrecondition, binding: str, lock: parseBundleLock }));
export const bundleLock = object({ path: absolutePath, before: resourcePrecondition });
export const planData = object({
  format: literal("harnessbrew.plan"), version: literal(1), id: str, requestDigest: digest, homeIdentity: str, userHome: absolutePath, baseRevision: identifier,
  contents: parseContents, sourceSnapshots: list(sourceSnapshot), adapterSignatures: list(signature), preconditions: list(resourcePrecondition),
  assetChanges: list(object({ asset: coordinate, type: literal("install", "update", "reactivate", "orphan"), reason: str })),
  operations: list(object({ id: str, asset: coordinate, placementIds: strings, resource, type: literal("link-directory", "link-file", "write-file", "write-block", "set-config", "remove-owned"), expectedBefore: fingerprint, requiredCapabilities: strings, dependsOn: strings, reason: literal("new-placement", "content-changed", "requirement-released", "repair-missing", "repair-owned"), "operation?": operation, "contentDigest?": digest, "existingOperationId?": str })),
  fileUpdates: list(object({ id: str, dependsOn: strings, path: absolutePath, before: resourcePrecondition, after, operationIds: strings })),
  expectedOperations: list(object({ id: str, asset: coordinate, contentDigest: digest, placementIds: strings, requirementIds: strings, operation, installedFingerprint: fingerprint, "previousOperationId?": str })),
  retainedOperations: list(object({ id: str, asset: coordinate, placementIds: strings, resource, type: operationType, installedFingerprint: fingerprint, createdDirectories: strings, requirementIds: strings })),
  "repair?": object({ operationIds: strings, overwriteOwned: bool, "contentDigests?": list(digest), "assetCoordinates?": list(coordinate) }),
  desiredState: object({ baseRevision: identifier, owners: list(owner), requirements: list(requirement), assets: list(object({ ...pin, snapshotId: str, dependencies: list(coordinate), conflicts: list(coordinate), requirementIds: strings, placements: list(object({ placement, requirementIds: strings })) })), orphanCoordinates: list(coordinate), retained: list(object({ coordinate, ownerIds: strings, reason: literal("still-required") })), requiredSources: list(object({ name: str, url: str })), "bundleLock?": parseBundleLock }),
  desiredStateDigest: digest
});
export function checkPrepared(check: Check, value: unknown): void {
  try { check(value); } catch (cause) { throw new HarnessError("INVALID_PLAN", "Malformed prepared change.", {}, { cause }); }
}
