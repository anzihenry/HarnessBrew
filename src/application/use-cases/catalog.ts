import type { HomeState } from "../../domain/home-state.js";
import type { CatalogSnapshot } from "../../domain/catalog.js";
import { loadCatalog } from "../../catalog/load.js";

export async function catalogFor(state: HomeState): Promise<CatalogSnapshot> {
  const needed = new Set([...state.sources.registrations.flatMap(s => s.selectedSnapshot ? [s.selectedSnapshot] : []), ...state.install.assets.filter(a => a.status === "active").map(a => a.snapshotId)]);
  return loadCatalog(state.sources.snapshots.filter(s => needed.has(s.id)), state.sources.registrations.flatMap(s => s.selectedSnapshot ? [s.selectedSnapshot] : []));
}
