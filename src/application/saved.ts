import type { ContentCheck } from "./content.js";
import type { HomeState } from "../domain/home-state.js";
import type { ChangeRequest } from "./types.js";
import type { ExecutionInput } from "../transactions/coordinator.js";
import type { CatalogSnapshot } from "../domain/catalog.js";
import type { ResourcePrecondition } from "../domain/plan.js";
export type PreparedChange = { lockUpdates?: import("./use-cases/upgrade-bundles.js").UpgradeLockUpdate[]; restorations?: import("../transactions/coordinator.js").ContentRestoration[]; contentChecks?: ContentCheck[]; contentChanges?: import("./content.js").ContentChange[]; format: "harnessbrew.saved-plan"; version: 2 | 3; adapterUpgrade?: { before: import("../domain/home-state.js").AdapterRegistration; after: import("../domain/home-state.js").AdapterRegistration }; id: string; home: string; homeIdentity: import("../domain/plan.js").PathIdentity; resources: string[]; preparedContent?: { digest: import("../domain/identity.js").Digest; staged: string }[]; request: ChangeRequest; baseRevision: string; candidate?: HomeState; plan?: ExecutionInput["plan"]; catalog?: CatalogSnapshot; bundleLock?: ExecutionInput["bundleLock"]; inputs: ResourcePrecondition[]; diagnostics: string[] };

export type Saved = PreparedChange;
