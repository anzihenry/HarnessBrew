import type { AssetKind, AssetManifest, InventoryEntry, ResolvedAsset } from "./assets.js";
import type { Digest } from "./identity.js";
import type { Placement } from "./placement.js";
import type { AppliedOperationType, Resource } from "./state.js";

export type ConfigValue = null | boolean | number | string | ConfigValue[] | { [key: string]: ConfigValue };
export type OperationPayload =
  | { type: "link-directory" | "link-file"; sourceRelativePath: string }
  | { type: "write-file"; content: string; mode: number }
  | { type: "write-block"; content: string; blockFormat: "html-comment" }
  | { type: "set-config"; value: ConfigValue };
export type AdapterOperation = OperationPayload & { resource: Resource };
export interface AssetView {
  readonly manifest: Readonly<AssetManifest>;
  readonly contentDigest: Digest;
  readonly inventory: readonly Readonly<InventoryEntry>[];
  readText(relativePath: string): Promise<string>;
}
export interface ResolvedPlacement {
  readonly placement: Placement;
  readonly roots: { readonly config: string; readonly skills: string; readonly instructions: string };
  readonly authorizedRoots: readonly string[];
}
export interface TargetAdapter {
  readonly protocol: "harnessbrew.adapter/1";
  readonly name: string;
  readonly version: string;
  readonly supportedKinds: readonly AssetKind[];
  readonly requiredCapabilities: readonly AppliedOperationType[];
  plan(asset: AssetView, placement: ResolvedPlacement): Promise<{ operations: AdapterOperation[] }>;
}
export interface AuthorizedAdapter {
  readonly adapter: TargetAdapter;
  readonly signature: Digest;
  readonly capabilities: readonly AppliedOperationType[];
  resolvePlacement(placement: Placement, userHome: string): ResolvedPlacement;
}
export interface AdapterProvider { get(name: string): AuthorizedAdapter }
export interface AssetReader { readAsset(asset: ResolvedAsset, relativePath: string): Promise<Uint8Array> }
