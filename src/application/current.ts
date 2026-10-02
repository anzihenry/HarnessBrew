import type { HomeState } from "../domain/home-state.js";
import type { DesiredState } from "../domain/resolution.js";
import { placementId } from "../domain/placement.js";
export function currentDesired(state: HomeState): DesiredState {
  return { baseRevision: state.revision, owners: state.install.owners, requirements: state.install.requirements,
    assets: state.install.assets.filter(a => a.status === "active").map(asset => {
      const refs = state.install.requirements.filter(req => req.resolvedAssets.some(pin => pin.coordinate === asset.coordinate));
      const placements = new Map(refs.flatMap(req => req.placements).map(p => [placementId(p), p]));
      return { coordinate: asset.coordinate, commit: asset.commit, contentDigest: asset.contentDigest, snapshotId: asset.snapshotId, dependencies: asset.dependencies, conflicts: asset.conflicts,
        requirementIds: refs.map(req => req.id).sort(), placements: [...placements].map(([id, placement]) => ({ placement, requirementIds: refs.filter(req => req.placements.some(p => placementId(p) === id)).map(req => req.id).sort() })) };
    }), orphanCoordinates: state.install.assets.filter(a => a.status === "orphan").map(a => a.coordinate), retained: [], requiredSources: [] };
}
