import { HarnessError } from "../../domain/errors.js";
import { parseHomeState, type HomeState } from "../../domain/home-state.js";
import { tapName } from "../../domain/identity.js";
import type { SourcePreparation } from "../dependencies.js";
import { loadCatalog } from "../../catalog/load.js";
import type { ChangeRequest } from "../types.js";
import type { Saved } from "../saved.js";
import type { PreparationContext } from "./context.js";

export async function prepareSources(context: PreparationContext, state: HomeState, request: ChangeRequest, saved: Saved, manager: SourcePreparation): Promise<Saved> {
  const next = structuredClone(state);
  const sourceRequest = request as Extract<ChangeRequest, { kind: "tap.add" | "tap.update" | "tap.remove" | "tap.trust" | "tap.untrust" }>;
  const name = sourceRequest.name === undefined ? undefined : tapName(sourceRequest.name);
  if (request.kind === "tap.add") {
    if (next.sources.registrations.some(s => s.name === name)) throw new HarnessError("INVALID_ARGUMENT", "Tap is already registered.");
    const selection = await manager.prepareSelection({ name: name!, url: request.url, ...(request.ref ? { ref: request.ref } : {}) });
    const { snapshot } = selection;
    await loadCatalog([snapshot], [snapshot.id]);
    next.sources.snapshots.push(snapshot); next.sources.registrations.push({ name: name!, url: request.url, trusted: false, ...(selection.ref ? { ref: selection.ref } : {}), selectedSnapshot: snapshot.id });
  } else if (request.kind === "tap.update") {
    const sources = next.sources.registrations.filter(s => name === undefined || s.name === name);
    if (name && !sources.length) throw new HarnessError("SOURCE_NOT_FOUND", "Tap is not registered.");
    for (const source of sources) {
      const previous = next.sources.snapshots.find(s => s.id === source.selectedSnapshot);
      const ref = request.defaultBranch ? undefined : request.ref ?? source.ref;
      const selection = await manager.prepareSelection({ name: source.name, url: source.url, ...(ref ? { ref } : {}), ...(previous ? { previous } : {}), ...(request.allowRewind === undefined ? {} : { allowRewind: request.allowRewind }) });
      const { snapshot } = selection;
      await loadCatalog([snapshot], [snapshot.id]);
      if (!next.sources.snapshots.some(s => s.id === snapshot.id)) next.sources.snapshots.push(snapshot);
      source.selectedSnapshot = snapshot.id;
      if (selection.ref) source.ref = selection.ref; else delete source.ref;
    }
  } else {
    const source = next.sources.registrations.find(s => s.name === name);
    if (!source) throw new HarnessError("SOURCE_NOT_FOUND", "Tap is not registered.");
    if (request.kind === "tap.remove") {
      if (state.install.assets.some(a => a.status === "active" && a.coordinate.startsWith(`${name}/`))) throw new HarnessError("SOURCE_IN_USE", "Tap has active requirements.");
      next.sources.registrations = next.sources.registrations.filter(s => s.name !== name);
      next.sources.snapshots = next.sources.snapshots.filter(s => s.tap !== name || next.install.assets.some(a => a.snapshotId === s.id));
    } else source.trusted = request.kind === "tap.trust";
  }
  saved.candidate = parseHomeState(next); return saved;
}
