import path from "node:path";
import { HarnessError } from "../../domain/errors.js";
import { hash } from "../../domain/identity.js";
import { canonicalJson } from "../../domain/validation.js";
import type { HomeState } from "../../domain/home-state.js";
import { planChange } from "../../planning/plan.js";
import { catalogAssetReader } from "../../ports/planning.js";
import { inspectAdapterCandidate, registryFor } from "../adapters.js";
import { currentDesired } from "../current.js";
import type { ChangeRequest } from "../types.js";
import type { Saved } from "../saved.js";
import type { PreparationContext } from "./context.js";
import { prepareRepair } from "./maintenance.js";

export async function prepareAdapterUpgrade(context: PreparationContext, state: HomeState, request: Extract<ChangeRequest, { kind: "adapter.upgrade" }>, saved: Saved): Promise<Saved> {
  const module = request.module === "builtin:codex" ? request.module : path.resolve(context.options.cwd, request.module);
  const inspection = await inspectAdapterCandidate(state, request.name, module);
  if (inspection.candidate.signature !== request.authorizedSignature) throw new HarnessError("ADAPTER_CHANGED", "Candidate differs from the explicitly authorized signature.");
  if (request.capabilities.some(c => !inspection.allowedCapabilities.includes(c))) throw new HarnessError("CAPABILITY_DENIED", "Candidate capability grant exceeds permitted operations.");
  if (inspection.affectedBindings.length) throw new HarnessError("ADAPTER_IN_USE", "Bundle upgrades require all affected manifests; joint upgrade is not yet enabled.", { bindings: inspection.affectedBindings });
  if (request.bundleFiles?.length) throw new HarnessError("LOCK_MISMATCH", "No affected Bundle accepts these manifest paths.");
  const after = { ...inspection.candidate, capabilities: [...request.capabilities] };
  const candidate = structuredClone(state);
  candidate.adapters.registrations = candidate.adapters.registrations.map(a => a.name === request.name ? after : a);
  // Digest and capability authorization precede the first candidate import.
  const registry = await registryFor(candidate, context.cache, [], true);
  const prepared = await prepareRepair(context, state, { kind: "repair", all: true });
  if (prepared.restorations.some(r => r.before.kind !== "missing")) throw new HarnessError("CONTENT_MODIFIED", "Repair changed content explicitly before upgrading adapters.");
  saved.version = 3; saved.adapterUpgrade = { before: inspection.current, after };
  saved.catalog = prepared.catalog;
  saved.plan = await planChange({ state: candidate, desired: currentDesired(state), catalog: prepared.catalog, adapters: registry, io: context.dependencies.planning, assets: catalogAssetReader(prepared.catalog), home: context.home, userHome: context.options.userHome, requestDigest: hash(canonicalJson(request)) });
  saved.diagnostics.push("Candidate code loaded under the explicit signature and capability grant; registration and targets remain unchanged until apply.");
  return saved;
}
