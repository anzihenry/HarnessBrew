import { HarnessError } from "../domain/errors.js";
import { placement } from "../domain/placement.js";
import { identifier, tapName } from "../domain/identity.js";
import { array, oneOf, record, text, unique } from "../domain/validation.js";
import type { ChangeRequest, ReadQuery } from "./types.js";
const fields: Record<ChangeRequest["kind"], string[]> = {
  "tap.add": ["name", "url", "ref"], "tap.update": ["name", "ref", "allowRewind"], "tap.remove": ["name"], "tap.trust": ["name"], "tap.untrust": ["name"],
  "adapter.add": ["module", "capabilities"], "adapter.remove": ["name"],
  "asset.install": ["coordinate", "placements"], "asset.upgrade": ["coordinate"], "asset.remove": ["coordinate"],
  "placement.link": ["coordinate", "placement"], "placement.unlink": ["coordinate", "placement"],
  "bundle.apply": ["file", "updateLock"], "bundle.detach": ["binding"], "cleanup": [], "repair": ["all", "coordinate", "placement", "overwriteOwned", "restoreContent"]
};
export function parseRequest(value: ChangeRequest): ChangeRequest {
  try {
    if (!value || !Object.hasOwn(fields, value.kind)) throw new Error("Unknown change request");
    const item = record(value, "change request", ["kind", ...fields[value.kind]]);
    for (const key of ["name", "url", "ref", "module", "coordinate", "file", "binding"]) if (item[key] !== undefined) text(item[key], key);
    for (const key of ["all", "allowRewind", "updateLock", "overwriteOwned", "restoreContent"]) if (item[key] !== undefined && typeof item[key] !== "boolean") throw new Error(`${key} must be boolean`);
    for (const key of fields[value.kind].filter(key => !["ref", "allowRewind", "updateLock", "overwriteOwned", "restoreContent", "placements"].includes(key))) {
      if (value.kind === "asset.upgrade" || value.kind === "tap.update" || value.kind === "repair" && ["coordinate", "placement", "all"].includes(key)) continue;
      if (item[key] === undefined) throw new Error(`Missing ${key}`);
    }
    if (value.kind === "repair" && ((item.all === true) === (item.coordinate !== undefined) || item.all === true && item.placement !== undefined)) throw new Error("Choose one asset or all assets; all cannot select a placement");
    if (item.name !== undefined) value.kind.startsWith("tap.") ? tapName(item.name) : identifier(item.name);
    if (item.capabilities !== undefined) unique(array(item.capabilities, "capabilities", v => oneOf(v, ["link-directory", "link-file", "write-file", "write-block", "set-config"] as const, "capability")), v => v, "capabilities");
    if (item.placement !== undefined) placement(item.placement);
    if (item.placements !== undefined) { if (!Array.isArray(item.placements)) throw new Error("placements must be an array"); item.placements.forEach(placement); }
    return structuredClone(value);
  } catch (cause) { throw new HarnessError("INVALID_ARGUMENT", "Invalid change request.", {}, { cause }); }
}

export function parseReadQuery(value: ReadQuery): ReadQuery {
  try {
    if (!value || !["list", "taps", "adapters", "outdated", "info", "search"].includes(value.kind)) throw new Error("Unknown query");
    record(value, "read query", ["kind", ...(value.kind === "search" ? ["text"] : value.kind === "info" ? ["coordinate"] : [])]);
    if (value.kind === "info") text(value.coordinate, "coordinate");
    if (value.kind === "search" && value.text !== undefined && typeof value.text !== "string") throw new Error("Search text must be a string");
    return structuredClone(value);
  } catch (cause) { throw new HarnessError("INVALID_ARGUMENT", "Invalid read query.", {}, { cause }); }
}
