import type { BundleLock, BundleManifest } from "./bundle.js";
import type { Coordinate } from "./identity.js";
import type { Placement, UsageOwner } from "./placement.js";
import type { AssetPin, UsageRequirement } from "./state.js";

export type ResolutionRequest =
  | { kind: "asset.install"; coordinate: string; placements?: Placement[] }
  | { kind: "asset.upgrade"; coordinate?: string }
  | { kind: "asset.remove"; coordinate: string }
  | { kind: "placement.link" | "placement.unlink"; coordinate: string; placement: Placement }
  | { kind: "bundle.apply"; manifest: BundleManifest; directory: string; lock?: BundleLock; updateLock?: boolean }
  | { kind: "bundle.detach"; ownerId: string };

export interface DesiredPlacement { placement: Placement; requirementIds: string[] }
export interface DesiredAsset extends AssetPin {
  snapshotId: string;
  dependencies: Coordinate[];
  conflicts: Coordinate[];
  requirementIds: string[];
  placements: DesiredPlacement[];
}
export interface DesiredState {
  baseRevision: string;
  owners: UsageOwner[];
  requirements: UsageRequirement[];
  assets: DesiredAsset[];
  /** Inventory records which no longer have an active requirement. No filesystem deletion implied. */
  orphanCoordinates: Coordinate[];
  retained: { coordinate: Coordinate; ownerIds: string[]; reason: "still-required" }[];
  /** Source configuration requested by a Bundle; never grants trust or commits active source selections. */
  requiredSources: { name: string; url: string }[];
  bundleLock?: BundleLock;
}
