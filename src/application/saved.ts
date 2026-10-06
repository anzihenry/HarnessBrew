import type { ContentCheck } from "./content.js";
import type { HomeState } from "../domain/home-state.js";
import type { ChangeRequest } from "./types.js";
import type { ExecutionInput } from "../transactions/coordinator.js";
import type { CatalogSnapshot } from "../domain/catalog.js";
import type { ResourcePrecondition } from "../domain/plan.js";
export type Saved = { restorations?: import("../transactions/coordinator.js").ContentRestoration[]; contentChecks?: ContentCheck[]; contentChanges?: import("./content.js").ContentChange[]; format: "harnessbrew.saved-plan"; version: 1; id: string; home: string; request: ChangeRequest; baseRevision: string; candidate?: HomeState; plan?: ExecutionInput["plan"]; catalog?: CatalogSnapshot; bundleLock?: ExecutionInput["bundleLock"]; inputs: ResourcePrecondition[]; diagnostics: string[] };
