import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { bundleManifestDigest, parseBundleLock, parseBundleManifest, type BundleLock } from "../../domain/bundle.js";
import { bundleOwner, resolvePlacement } from "../../domain/placement.js";
import { canonicalJson } from "../../domain/validation.js";
import { HarnessError } from "../../domain/errors.js";
import type { AdapterRegistration, HomeState } from "../../domain/home-state.js";
import type { ResourcePrecondition } from "../../domain/plan.js";
import { precondition } from "../../planning/resources.js";
import type { PreparationContext } from "./context.js";
export interface UpgradeLockUpdate { path: string; before: ResourcePrecondition; binding: string; lock: BundleLock }
const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const sorted = (a: unknown[]) => [...a].sort((a,b) => canonicalJson(a).localeCompare(canonicalJson(b)));
const mismatch = (message: string, details = {}): never => { throw new HarnessError("LOCK_MISMATCH", message, details); };

/** Validate every affected checkout against current requirements and exact pins;
 * only the requested adapter signature is permitted to differ in the new lock. */
export async function prepareUpgradeBundles(context: PreparationContext, state: HomeState, after: AdapterRegistration, files: string[], required: string[]) {
  const seen = new Set<string>(), updates: UpgradeLockUpdate[] = [], inputs: ResourcePrecondition[] = [];
  for (const supplied of files) {
    try {
      const file = path.resolve(context.options.cwd, supplied), directory = await realpath(path.dirname(file));
      const manifestBefore = precondition(await context.dependencies.planning.inspect(file));
      if (manifestBefore.fingerprint.kind !== "file") mismatch("Manifest must be a regular file.", { file });
      const manifest = parseBundleManifest(parseYaml(await readFile(file, "utf8")));
      const binding = bundleOwner(manifest.id, directory).id;
      if (!required.includes(binding)) mismatch("Manifest does not identify an affected binding.", { binding });
      if (seen.has(binding)) mismatch("Duplicate binding or aliased checkout.", { binding });
      seen.add(binding);
      const lockPath = `${file}.lock.json`, before = precondition(await context.dependencies.planning.inspect(lockPath));
      if (before.fingerprint.kind !== "file") mismatch("An existing regular Bundle lock is required.", { binding });
      const lock = parseBundleLock(JSON.parse(await readFile(lockPath, "utf8")));
      const requirements = state.install.requirements.filter(r => r.ownerId === binding);
      if (requirements.length !== manifest.assets.length || manifest.assets.some(root => {
        const req = requirements.find(r => r.rootCoordinate === root.coordinate);
        return !req || !equal(sorted(req.placements), sorted(root.placements.map(p => resolvePlacement(p, directory))));
      })) mismatch("Manifest requirements differ from the installed binding.", { binding });
      const coordinates = new Set(requirements.flatMap(r => r.resolvedAssets.map(a => a.coordinate)));
      const assets = state.install.assets.filter(a => coordinates.has(a.coordinate));
      const sourceMap = new Map<string, { name: string; url: string; commits: typeof assets[number]["commit"][] }>();
      for (const asset of assets) {
        const snapshot = state.sources.snapshots.find(s => s.id === asset.snapshotId)!;
        if (!manifest.sources.some(s => s.name === snapshot.tap && s.git === snapshot.url)) mismatch("Manifest source differs from installed provenance.", { binding });
        const source = sourceMap.get(snapshot.tap) ?? { name: snapshot.tap, url: snapshot.url, commits: [] };
        if (!source.commits.some(c => equal(c, asset.commit))) source.commits.push(asset.commit);
        sourceMap.set(snapshot.tap, source);
      }
      const targets = new Set(manifest.assets.flatMap(a => a.placements.map(p => p.target)));
      const expected = parseBundleLock({ format: "harnessbrew.lock", version: 1, manifestDigest: bundleManifestDigest(manifest), roots: manifest.assets, sources: [...sourceMap.values()], assets: assets.map(a => ({ coordinate: a.coordinate, commit: a.commit, contentDigest: a.contentDigest, dependencies: a.dependencies })), adapterSignatures: state.adapters.registrations.filter(a => targets.has(a.name)).map(a => ({ name: a.name, version: a.version, signature: a.signature })) });
      if (!equal(expected, lock)) mismatch("Bundle lock, declarations or installed pins have drifted.", { binding });
      const next = parseBundleLock({ ...lock, adapterSignatures: lock.adapterSignatures.map(a => a.name === after.name ? { name: after.name, version: after.version, signature: after.signature } : a) });
      inputs.push(manifestBefore);
      updates.push({ path: lockPath, before, binding, lock: next });
    } catch (cause) {
      if (cause instanceof HarnessError && cause.code === "LOCK_MISMATCH") throw cause;
      throw new HarnessError("LOCK_MISMATCH", "Cannot verify affected Bundle manifest and lock.", { file: supplied }, { cause });
    }
  }
  const missingBindings = required.filter(id => !seen.has(id));
  if (missingBindings.length) mismatch("Provide every affected Bundle manifest with --bundle-file.", { missingBindings });
  return { updates: updates.sort((a,b) => a.path.localeCompare(b.path)), inputs };
}
