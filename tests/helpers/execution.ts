import { chmod, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { inventoryDigest, type AssetKind } from "../../src/domain/assets.js";
import type { CatalogSnapshot } from "../../src/domain/catalog.js";
import { coordinate, hash } from "../../src/domain/identity.js";
import { StateStore } from "../../src/storage/state-store.js";
import { AdapterRegistry } from "../../src/adapters/registry.js";
import { catalogAssetReader, nodePlanningIO } from "../../src/ports/planning.js";
import { resolveRequest } from "../../src/resolution/resolve.js";
import { planChange } from "../../src/planning/plan.js";
import type { ResolutionRequest } from "../../src/domain/resolution.js";
import type { HomeState } from "../../src/domain/home-state.js";
import type { ExecutionInput } from "../../src/transactions/coordinator.js";
export const A = coordinate("test/assets/a"), B = coordinate("test/assets/b");
export function adapters(): AdapterRegistry { const registry = new AdapterRegistry(); registry.registerCodex(hash("codex")); return registry; }
export async function fixture(kind: AssetKind = "skill", count = 1) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "hb-execution-")));
  const home = path.join(root, "home"), project = path.join(root, "project"), lockRoot = path.join(root, "locks");
  await mkdir(project);
  const source = path.join(root, "source");
  const commit = { algorithm: "sha1" as const, value: "a".repeat(40) };
  const catalog: CatalogSnapshot = { snapshots: [{ id: "snapshot-1", tap: "test/assets", url: source, commit, treeDigest: hash("fixture"), contentLocation: source }], selectedSnapshotIds: ["snapshot-1"], assets: [] };
  const assets = [];
  for (const name of [A, B].slice(0, count)) {
    const short = name.split("/")[2]!;
    const content = kind === "skill" ? `---\nname: ${short}\ndescription: test\n---\n# Test\n` : kind === "mcp" ? '{"transport":"stdio","command":"tool","envVars":["TOKEN"]}' : `# ${short}\n`;
    const directory = path.join(source, "assets", short); await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "SKILL.md"), content); await chmod(path.join(directory, "SKILL.md"), 0o644);
    const inventory = [{ path: "SKILL.md", type: "file" as const, digest: hash(content), mode: 0o644 }];
    assets.push({ manifest: { coordinate: name, kind, entry: "SKILL.md", description: "test", dependencies: name === A && count > 1 ? [B] : [], conflicts: [], targets: ["openai-codex"] }, snapshotId: "snapshot-1", commit, inventory, contentDigest: inventoryDigest(inventory) });
  }
  catalog.assets = assets;
  const store = new StateStore(home), initial = await store.initialize();
  initial.sources = { format: "harnessbrew.source-state", version: 1, snapshots: [...catalog.snapshots], registrations: [{ name: "test/assets", url: source, selectedSnapshot: "snapshot-1", trusted: true }] };
  initial.adapters.registrations.push({ name: "openai-codex", module: "builtin:codex", protocol: "harnessbrew.adapter/1", version: "1", signature: hash("codex"), capabilities: ["link-directory", "link-file", "write-file", "write-block", "set-config"] });
  const state = await store.commit(initial.revision, initial);
  const request: ResolutionRequest = { kind: "asset.install", coordinate: A, placements: [{ target: "openai-codex", scope: "project", projectRoot: project }] };
  await writeFile(path.join(root, "fixture.json"), JSON.stringify({ home, project, catalog, request, lockRoot }));
  return { root, home, project, lockRoot, catalog, store, state, request,
    plan: (current: HomeState = state, requested: ResolutionRequest = request) => build(home, current, catalog, requested) };
}
export async function build(home: string, state: HomeState, catalog: CatalogSnapshot, request: ResolutionRequest): Promise<ExecutionInput> {
  const registry = adapters(), reader = catalogAssetReader(catalog);
  return { plan: await planChange({ state, desired: resolveRequest(state, catalog, request), catalog, adapters: registry, assets: reader, io: nodePlanningIO, home, userHome: path.dirname(home), requestDigest: hash(JSON.stringify(request)) }), catalog, adapters: registry, assets: reader };
}
