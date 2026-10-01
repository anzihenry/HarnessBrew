import type { ResolvedAsset, SourceSnapshot } from "./assets.js";

export interface CatalogSnapshot {
  /** All exact versions required for current installs, locks, and latest source selections. */
  assets: readonly ResolvedAsset[];
  snapshots: readonly SourceSnapshot[];
  /** At most one candidate snapshot per Tap. Historical snapshots remain available for pins. */
  selectedSnapshotIds: readonly string[];
}
export function freezeData<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeData);
    Object.freeze(value);
  }
  return value;
}
