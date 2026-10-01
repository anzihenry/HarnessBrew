import type { AdapterOperation } from "../domain/adapter.js";
import type { ResourcePrecondition, TargetFingerprint, TargetSnapshot } from "../domain/plan.js";
import type { Fingerprint, Resource } from "../domain/state.js";
import { HarnessError } from "../domain/errors.js";
import { hash } from "../domain/identity.js";
import { canonicalJson } from "../domain/validation.js";
import { configValue, editConfig, readConfig } from "./config.js";

export function fingerprint(snapshot: TargetSnapshot): TargetFingerprint {
  switch (snapshot.kind) {
    case "file": return { kind: "file", digest: hash(canonicalJson({ content: snapshot.content, mode: snapshot.mode })) };
    case "symlink": return { kind: "symlink", target: snapshot.target };
    case "directory": return { kind: "directory", digest: hash("directory") };
    default: return { kind: snapshot.kind };
  }
}
export function precondition(snapshot: TargetSnapshot): ResourcePrecondition {
  return { path: snapshot.path, identity: snapshot.identity, fingerprint: fingerprint(snapshot), ...(snapshot.kind === "file" ? { mode: snapshot.mode } : {}) };
}
function block(content: string, marker: string): { start: number; end: number; body: string } | undefined {
  const startMarker = `<!-- harnessbrew:${marker}:begin -->`, endMarker = `<!-- harnessbrew:${marker}:end -->`;
  const start = content.indexOf(startMarker), finish = content.indexOf(endMarker);
  if (start === -1 && finish === -1) return undefined;
  if (start < 0 || finish < start || content.indexOf(startMarker, start + 1) >= 0 || content.indexOf(endMarker, finish + 1) >= 0 || (start > 0 && content[start - 1] !== "\n")) throw new HarnessError("TARGET_MODIFIED", "Malformed or duplicate managed block.");
  const begin = start + startMarker.length;
  const end = finish + endMarker.length;
  if (content[begin] !== "\n" || content[finish - 1] !== "\n" || (end < content.length && content[end] !== "\n")) throw new HarnessError("TARGET_MODIFIED", "Managed block markers must occupy separate lines.");
  const body = content.slice(begin + 1, finish);
  if (body.includes("<!-- harnessbrew:")) throw new HarnessError("OWNERSHIP_CONFLICT", "Managed blocks cannot overlap.");
  return { start, end: end + (content[end] === "\n" ? 1 : 0), body };
}
export function resourceFingerprint(snapshot: TargetSnapshot, resource: Resource): TargetFingerprint {
  if (resource.kind === "path" || snapshot.kind !== "file") return fingerprint(snapshot);
  if (resource.kind === "block") {
    const found = block(snapshot.content, resource.marker);
    return found ? { kind: "file", digest: hash(found.body) } : { kind: "missing" };
  }
  const value = readConfig(snapshot.content, resource.format, resource.keyPath);
  return value === undefined ? { kind: "missing" } : { kind: "file", digest: hash(canonicalJson(configValue(value))) };
}
export function desiredFingerprint(operation: AdapterOperation, source: string): Fingerprint {
  switch (operation.type) {
    case "link-directory": case "link-file": return { kind: "symlink", target: source };
    case "write-file": return { kind: "file", digest: hash(canonicalJson({ content: operation.content, mode: operation.mode })) };
    case "write-block": return { kind: "file", digest: hash(operation.content.endsWith("\n") ? operation.content : `${operation.content}\n`) };
    case "set-config": return { kind: "file", digest: hash(canonicalJson(operation.value)) };
  }
}
export function editShared(content: string, resource: Resource, operation?: AdapterOperation): string {
  if (resource.kind === "config") {
    if (operation && operation.type !== "set-config") throw new HarnessError("INVALID_PLAN", "Config operation mismatch.");
    return editConfig(content, resource.format, resource.keyPath, operation?.value);
  }
  if (resource.kind !== "block" || (operation && operation.type !== "write-block")) throw new HarnessError("INVALID_PLAN", "Shared operation mismatch.");
  const found = block(content, resource.marker);
  const replacement = operation ? `<!-- harnessbrew:${resource.marker}:begin -->\n${operation.content.endsWith("\n") ? operation.content : `${operation.content}\n`}<!-- harnessbrew:${resource.marker}:end -->\n` : "";
  if (found) return content.slice(0, found.start) + replacement + content.slice(found.end);
  if (!operation) return content;
  return content + (content && !content.endsWith("\n") ? "\n" : "") + replacement;
}
