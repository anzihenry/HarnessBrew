import { lstat } from "node:fs/promises";
import path from "node:path";
import { HarnessError } from "../../domain/errors.js";
import { type HomeState } from "../../domain/home-state.js";
import { resolveAsset } from "../../domain/identity.js";
import type { CatalogSnapshot } from "../../domain/catalog.js";
import { image } from "../../execution/files.js";
import type { ChangeRequest } from "../types.js";
import type { PreparationContext } from "./context.js";
import { prepareRestore } from "../restore.js";
export { planCleanup } from "../content.js";

export async function prepareRepair(context: PreparationContext, state: HomeState, request: Extract<ChangeRequest, { kind: "repair" }>) {
  const active = state.install.assets.filter(a => a.status === "active");
  const selected = request.all ? active : [resolveAsset(active, request.coordinate!)];
  const affected = new Set(selected.map(a => a.coordinate));
  const restorations: import("../../transactions/coordinator.js").ContentRestoration[] = [];
  const changes: import("../../domain/content.js").ContentChange[] = [];
  const snapshots = new Map<string, CatalogSnapshot["snapshots"][number]>();
  const assets = new Map<string, CatalogSnapshot["assets"][number]>();
  const preparedDigests = new Set<string>();
  for (const asset of selected) {
    const source = state.sources.registrations.find(s => asset.coordinate.startsWith(`${s.name}/`));
    if (!source?.trusted) throw new HarnessError("SOURCE_UNTRUSTED", "Repair requires trusted sources.", { asset: asset.coordinate });
    if (preparedDigests.has(asset.contentDigest)) continue;
    preparedDigests.add(asset.contentDigest);
    const destination = path.join(context.home, "content", asset.contentDigest.slice(7));
    const before = await image(destination, true);
    const damaged = before.kind !== "content" || before.digest !== asset.contentDigest;
    if (damaged && before.kind !== "missing" && !request.restoreContent) throw new HarnessError("CONTENT_MODIFIED", "Content was modified; use --restore-content to preserve it in quarantine and restore the installed version.", { asset: asset.coordinate });
    const prepared = await prepareRestore(state, asset.coordinate, context.cache, context.dependencies.sources);
    for (const snapshot of prepared.catalog.snapshots) snapshots.set(snapshot.id, snapshot);
    for (const item of prepared.catalog.assets) assets.set(`${item.manifest.coordinate}:${item.snapshotId}`, item);
    if (damaged) {
      const refs = active.filter(a => a.contentDigest === asset.contentDigest).map(a => a.coordinate);
      for (const name of refs) affected.add(name);
      let bytes = 0; for (const entry of state.contents.find(c => c.digest === prepared.digest)!.inventory) if (entry.type === "file") bytes += (await lstat(path.join(prepared.staged, entry.path))).size;
      restorations.push({ digest: prepared.digest, staged: prepared.staged, before, bytes });
      changes.push({ digest: prepared.digest, action: "restore", path: destination, bytes, commit: prepared.commit, affectedAssets: refs });
    }
  }
  const catalog: CatalogSnapshot = { snapshots: [...snapshots.values()].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0), assets: [...assets.entries()].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0).map(([,a]) => a), selectedSnapshotIds: [] };
  return { catalog, restorations, changes, affected: [...affected].sort() };
}
