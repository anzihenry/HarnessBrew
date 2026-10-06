import type { ApplicationDependencies } from "../dependencies.js";
import type { HarnessOptions } from "../types.js";

export interface PreparationContext { home: string; cache: string; options: HarnessOptions; dependencies: ApplicationDependencies }
