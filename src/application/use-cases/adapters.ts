import path from "node:path";
import { HarnessError } from "../../domain/errors.js";
import { parseHomeState, type HomeState } from "../../domain/home-state.js";
import { builtinRegistration, inspectPlugin } from "../adapters.js";
import type { ChangeRequest } from "../types.js";
import type { Saved } from "../saved.js";
import type { PreparationContext } from "./context.js";

export async function prepareAdapter(context: PreparationContext, state: HomeState, request: Extract<ChangeRequest, { kind: "adapter.add" | "adapter.remove" }>, saved: Saved): Promise<Saved> {
  const next = structuredClone(state);
  if (request.kind === "adapter.remove") {
    if (state.install.requirements.some(req => req.placements.some(p => p.target === request.name))) throw new HarnessError("ADAPTER_IN_USE", "Release active placements before removing the adapter.");
    if (!next.adapters.registrations.some(a => a.name === request.name)) throw new HarnessError("TARGET_UNSUPPORTED", "Adapter is not registered.");
    next.adapters.registrations = next.adapters.registrations.filter(a => a.name !== request.name);
  } else {
    const registration = request.module === "builtin:codex" ? await builtinRegistration() : await inspectPlugin(path.resolve(context.options.cwd, request.module), request.capabilities);
    if (next.adapters.registrations.some(a => a.name === registration.name)) throw new HarnessError("INVALID_ARGUMENT", "Remove the existing adapter before registering another version.");
    next.adapters.registrations.push(registration);
    saved.diagnostics.push("Plugin exports will be checked during authorized execution; preview does not import new plugin code.");
  }
  saved.candidate = parseHomeState(next); return saved;
}
