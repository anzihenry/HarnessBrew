import type { AdapterOperation, AuthorizedAdapter, ResolvedPlacement } from "../domain/adapter.js";
import type { ResolvedAsset } from "../domain/assets.js";
import { HarnessError } from "../domain/errors.js";
import { contained, relativePath } from "../domain/identity.js";
import { resource } from "../domain/state.js";
import { array, canonicalJson, oneOf, record, unique } from "../domain/validation.js";
import { configValue } from "./config.js";

export function validateAdapterPlan(value: unknown, authorized: AuthorizedAdapter, asset: ResolvedAsset, placement: ResolvedPlacement): AdapterOperation[] {
  const plan = record(value, "adapter plan", ["operations"]);
  const result = array(plan.operations, "adapter operations", raw => {
    const item = record(raw, "adapter operation", ["type", "resource", "sourceRelativePath", "content", "mode", "blockFormat", "value"]);
    const type = oneOf(item.type, ["link-directory", "link-file", "write-file", "write-block", "set-config"] as const, "operation type");
    if (!authorized.capabilities.includes(type) || !authorized.adapter.requiredCapabilities.includes(type)) throw new HarnessError("CAPABILITY_DENIED", `Adapter is not authorized for ${type}.`);
    const target = resource(item.resource);
    if (!placement.authorizedRoots.some(root => contained(root, target.path, false))) throw new HarnessError("INVALID_PLAN", "Adapter destination escapes authorized roots.");
    const allowed = type === "link-directory" || type === "link-file" ? ["sourceRelativePath"] : type === "write-file" ? ["content", "mode"] : type === "write-block" ? ["content", "blockFormat"] : ["value"];
    record(raw, "operation payload", ["type", "resource", ...allowed]);
    if ((type === "write-block" && target.kind !== "block") || (type === "set-config" && target.kind !== "config") || ((type === "link-directory" || type === "link-file" || type === "write-file") && (target.kind !== "path" || target.pathType !== (type === "link-directory" ? "directory" : "file")))) throw new HarnessError("INVALID_PLAN", "Operation resource type mismatch.");
    if (type === "link-directory" || type === "link-file") {
      const source = item.sourceRelativePath === "." && type === "link-directory" ? "." : relativePath(item.sourceRelativePath);
      if (source !== "." && !asset.inventory.some(entry => entry.path === source && entry.type === (type === "link-directory" ? "directory" : "file"))) throw new HarnessError("INVALID_PLAN", "Link source is absent from asset inventory.");
      return { type, resource: target, sourceRelativePath: source };
    }
    if (type === "set-config") return { type, resource: target, value: configValue(item.value) };
    if (typeof item.content !== "string" || item.content.includes("\0")) throw new HarnessError("INVALID_PLAN", "Invalid UTF-8 operation content.");
    if (type === "write-block") {
      if (item.blockFormat !== "html-comment" || item.content.includes("<!-- harnessbrew:")) throw new HarnessError("INVALID_PLAN", "Invalid managed block payload.");
      return { type, resource: target, content: item.content, blockFormat: "html-comment" as const };
    }
    if (!Number.isInteger(item.mode) || (item.mode as number) < 0 || (item.mode as number) > 0o777) throw new HarnessError("INVALID_PLAN", "Invalid file mode.");
    return { type, resource: target, content: item.content, mode: item.mode as number };
  });
  if (!result.length) throw new HarnessError("INVALID_PLAN", "A requested placement must produce at least one operation.");
  return unique(result, value => canonicalJson(value.resource), "adapter resource addresses");
}
