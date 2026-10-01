import path from "node:path";
import type { ResolvedPlacement } from "../domain/adapter.js";
import { absolutePath } from "../domain/identity.js";
import { placement as parsePlacement, type Placement } from "../domain/placement.js";

export function codexPlacement(input: Placement, userHome: string): ResolvedPlacement {
  const placement = parsePlacement(input);
  const base = placement.projectRoot ?? absolutePath(userHome);
  const config = placement.rootOverride ?? path.join(base, ".codex");
  const agents = placement.rootOverride ?? path.join(base, ".agents");
  const instructions = placement.rootOverride ?? (placement.scope === "project" ? base : config);
  return { placement, roots: { config, skills: path.join(agents, "skills"), instructions },
    authorizedRoots: [...new Set([config, agents, instructions])].sort() };
}
