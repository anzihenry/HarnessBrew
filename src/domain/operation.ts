import type { HomeState, AdapterRegistration } from "./home-state.js";
import type { AssetChange } from "./plan.js";
/** Additive, discriminated SDK effects; legacy changes remain available. */
export type OperationEffect = { kind: "asset"; change: AssetChange }
  | { kind: "metadata"; operation: string; before: HomeState; after: HomeState }
  | { kind: "adapter-upgrade"; before: AdapterRegistration; after: AdapterRegistration };
