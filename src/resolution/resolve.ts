import type { ResolvedAsset } from "../domain/assets.js";
import { bundleManifestDigest, parseBundleLock, parseBundleManifest, type BundleLock, type BundleManifest } from "../domain/bundle.js";
import { freezeData, type CatalogSnapshot } from "../domain/catalog.js";
import { HarnessError } from "../domain/errors.js";
import { assertNoConflicts, dependencyClosure } from "../domain/graph.js";
import { resolveAsset, type Coordinate } from "../domain/identity.js";
import { bundleOwner, placement, placementId, requirementId, resolvePlacement, type Placement, type UsageOwner } from "../domain/placement.js";
import type { DesiredAsset, DesiredState, ResolutionRequest } from "../domain/resolution.js";
import type { AssetPin, UsageRequirement } from "../domain/state.js";
import { canonicalJson, record, sortBy, text } from "../domain/validation.js";
import { parseHomeState, type HomeState } from "../domain/home-state.js";
import { CatalogIndex, sameVersion } from "../domain/catalog-index.js";

interface Candidate extends AssetPin {
  snapshotId: string; dependencies: Coordinate[]; conflicts: Coordinate[]; resolved?: ResolvedAsset;
}
interface Root { coordinate: Coordinate; placements: Placement[] }
function fromResolved(asset: ResolvedAsset): Candidate {
  return { coordinate: asset.manifest.coordinate, commit: asset.commit, contentDigest: asset.contentDigest,
    snapshotId: asset.snapshotId, dependencies: asset.manifest.dependencies, conflicts: asset.manifest.conflicts, resolved: asset };
}
function toPin(asset: Candidate): AssetPin {
  return { coordinate: asset.coordinate, commit: asset.commit, contentDigest: asset.contentDigest };
}
function placements(values: readonly Placement[]): Placement[] {
  const result = new Map(values.map(value => { const parsed = placement(value); return [placementId(parsed), parsed]; }));
  return sortBy([...result.values()], placementId);
}
function validateRequest(request: ResolutionRequest): void {
  const keys: Record<ResolutionRequest["kind"], string[]> = {
    "asset.install": ["coordinate", "placements"], "asset.upgrade": ["coordinate"], "asset.remove": ["coordinate"],
    "placement.link": ["coordinate", "placement"], "placement.unlink": ["coordinate", "placement"],
    "bundle.apply": ["manifest", "directory", "lock", "updateLock"], "bundle.detach": ["ownerId"]
  };
  if (!request || !Object.hasOwn(keys, request.kind)) throw new HarnessError("INVALID_ARGUMENT", "Unsupported resolution request.");
  record(request, "resolution request", ["kind", ...keys[request.kind]]);
  if (request.kind === "asset.install" || request.kind === "asset.remove" || request.kind === "placement.link" || request.kind === "placement.unlink") text(request.coordinate, "asset query");
  if (request.kind === "asset.upgrade" && request.coordinate !== undefined) text(request.coordinate, "asset query");
  if (request.kind === "asset.install" && request.placements !== undefined && !Array.isArray(request.placements)) {
    throw new HarnessError("INVALID_ARGUMENT", "placements must be an array.");
  }
  if (request.kind === "bundle.apply" && request.updateLock !== undefined && typeof request.updateLock !== "boolean") {
    throw new HarnessError("INVALID_ARGUMENT", "updateLock must be a boolean.");
  }
}

/** Pure resolution: does not write state, edit files, fetch sources, or execute adapters. */
export function resolveRequest(input: HomeState, catalogInput: CatalogSnapshot, inputRequest: ResolutionRequest): DesiredState {
  const request = structuredClone(inputRequest);
  validateRequest(request);
  const state = parseHomeState(input);
  const index = new CatalogIndex(catalogInput);
  const current = new Map<Coordinate, Candidate>();
  for (const installed of state.install.assets.filter(asset => asset.status === "active")) {
    const full = index.pinned(installed);
    if (full && (canonicalJson(full.manifest.dependencies) !== canonicalJson(installed.dependencies)
      || canonicalJson(full.manifest.conflicts) !== canonicalJson(installed.conflicts))) {
      throw new HarnessError("CONTENT_MODIFIED", "Installed asset metadata differs from its pinned catalog version.", { asset: installed.coordinate });
    }
    current.set(installed.coordinate, { ...toPin(installed), snapshotId: installed.snapshotId,
      dependencies: installed.dependencies, conflicts: installed.conflicts, ...(full ? { resolved: full } : {}) });
  }
  const owners = new Map(state.install.owners.map(value => [value.id, value]));
  const currentRequirements = state.install.requirements;
  const manualRoots = new Map<Coordinate, Root>(currentRequirements.filter(req => req.ownerId === "manual")
    .map(req => [req.rootCoordinate, { coordinate: req.rootCoordinate, placements: req.placements }]));
  const manualCandidates = new Map(current);
  const queryAssets = new Map([...current.keys(), ...index.latest.keys()].map(name => [name, { coordinate: name }]));
  const selectedName = (query: string): Coordinate => resolveAsset([...queryAssets.values()], query).coordinate;
  const manualRoot = (query: string): Root => {
    const name = selectedName(query);
    const root = manualRoots.get(name);
    if (!root) throw new HarnessError("NOT_MANUAL_ROOT", `Asset is not a manual root: ${name}`, {
      asset: name, ownerIds: [...new Set(currentRequirements.filter(req => req.resolvedAssets.some(pin => pin.coordinate === name)).map(req => req.ownerId))].sort()
    });
    return root;
  };
  const latest = (name: Coordinate): Candidate | undefined => {
    const value = index.latest.get(name);
    return value && fromResolved(value);
  };
  const manualLookup = (name: Coordinate): Candidate | undefined => {
    const found = manualCandidates.get(name) ?? latest(name);
    if (found) manualCandidates.set(name, found);
    return found;
  };
  const released = new Set<Coordinate>();
  let bundle: BundleManifest | undefined;
  let bundleBinding: UsageOwner | undefined;
  let providedLock: BundleLock | undefined;
  let bundleRoots: Root[] = [];
  const selectedBundle = new Map<Coordinate, Candidate>();
  let remaining = currentRequirements.filter(req => req.ownerId !== "manual");

  switch (request.kind) {
    case "asset.install": {
      const name = selectedName(request.coordinate);
      owners.set("manual", { id: "manual", kind: "manual" });
      const previous = manualRoots.get(name);
      manualRoots.set(name, { coordinate: name, placements: placements([...(previous?.placements ?? []), ...(request.placements ?? [])]) });
      break;
    }
    case "asset.upgrade": {
      const roots = request.coordinate === undefined ? [...manualRoots.values()] : [manualRoot(request.coordinate)];
      for (const root of roots) {
        if (!latest(root.coordinate)) throw new HarnessError("ASSET_NOT_FOUND", `Upgrade candidate is unavailable: ${root.coordinate}`);
        for (const asset of dependencyClosure(root.coordinate, latest)) manualCandidates.set(asset.coordinate, asset);
      }
      break;
    }
    case "asset.remove": {
      const root = manualRoot(request.coordinate);
      manualRoots.delete(root.coordinate);
      for (const pin of currentRequirements.find(req => req.id === requirementId("manual", root.coordinate))!.resolvedAssets) released.add(pin.coordinate);
      break;
    }
    case "placement.link":
    case "placement.unlink": {
      const root = manualRoot(request.coordinate);
      const target = placement(request.placement);
      if (request.kind === "placement.link") root.placements = placements([...root.placements, target]);
      else {
        if (!root.placements.some(value => placementId(value) === placementId(target))) throw new HarnessError("INVALID_ARGUMENT", "The manual root does not request this placement.");
        root.placements = root.placements.filter(value => placementId(value) !== placementId(target));
      }
      break;
    }
    case "bundle.detach": {
      const binding = owners.get(text(request.ownerId, "Bundle owner"));
      if (!binding || binding.kind !== "bundle") throw new HarnessError("OWNER_NOT_FOUND", "Bundle binding does not exist.");
      for (const req of remaining.filter(req => req.ownerId === binding.id)) for (const pin of req.resolvedAssets) released.add(pin.coordinate);
      remaining = remaining.filter(req => req.ownerId !== binding.id);
      owners.delete(binding.id);
      break;
    }
    case "bundle.apply": {
      bundle = parseBundleManifest(request.manifest);
      bundleBinding = bundleOwner(bundle.id, request.directory);
      owners.set(bundleBinding.id, bundleBinding);
      for (const req of remaining.filter(req => req.ownerId === bundleBinding!.id)) for (const pin of req.resolvedAssets) released.add(pin.coordinate);
      remaining = remaining.filter(req => req.ownerId !== bundleBinding!.id);
      bundleRoots = bundle.assets.map(root => ({ coordinate: root.coordinate, placements: placements(root.placements.map(value => resolvePlacement(value, bundleBinding!.directory!))) }));
      if (request.lock !== undefined && !request.updateLock) {
        providedLock = parseBundleLock(request.lock);
        if (providedLock.manifestDigest !== bundleManifestDigest(bundle) || canonicalJson(providedLock.roots) !== canonicalJson(bundle.assets)) {
          throw new HarnessError("LOCK_MISMATCH", "Manifest differs from its lock; explicitly update the lock.");
        }
      }
      const lockedPins = new Map(providedLock?.assets.map(asset => [asset.coordinate, asset]) ?? []);
      const lookup = (name: Coordinate): Candidate | undefined => {
        if (!providedLock) return latest(name);
        const pin = lockedPins.get(name);
        if (!pin) throw new HarnessError("LOCK_MISMATCH", `Dependency is absent from the lock: ${name}`);
        const exact = index.pinned(pin);
        if (exact) return fromResolved(exact);
        const installed = current.get(name);
        if (installed && sameVersion(installed, pin)) return installed;
        throw new HarnessError("LOCK_MISMATCH", `Pinned asset is unavailable or modified: ${name}`);
      };
      for (const root of bundleRoots) {
        for (const asset of dependencyClosure(root.coordinate, lookup)) selectedBundle.set(asset.coordinate, asset);
      }
      break;
    }
  }

  const allCandidates = new Map<Coordinate, Candidate>();
  const requirements: UsageRequirement[] = [];
  const claim = (ownerId: string, root: Root, assets: Candidate[]): void => {
    for (const asset of assets) {
      const existing = allCandidates.get(asset.coordinate);
      if (existing && !sameVersion(existing, asset)) throw new HarnessError("VERSION_CONFLICT", `Owners require different versions of ${asset.coordinate}.`, {
        asset: asset.coordinate, ownerId, otherOwnerIds: requirements.filter(req => req.resolvedAssets.some(pin => pin.coordinate === asset.coordinate)).map(req => req.ownerId).sort()
      });
      if (!existing || asset.resolved) allCandidates.set(asset.coordinate, asset);
    }
    requirements.push({ id: requirementId(ownerId, root.coordinate), ownerId, rootCoordinate: root.coordinate,
      placements: placements(root.placements), resolvedAssets: sortBy(assets.map(toPin), asset => asset.coordinate) });
  };
  for (const req of remaining) {
    claim(req.ownerId, { coordinate: req.rootCoordinate, placements: req.placements }, req.resolvedAssets.map(pin => current.get(pin.coordinate)!));
  }
  for (const root of sortBy([...manualRoots.values()], root => root.coordinate)) claim("manual", root, dependencyClosure(root.coordinate, manualLookup));
  if (bundleBinding) for (const root of bundleRoots) claim(bundleBinding.id, root, dependencyClosure(root.coordinate, name => selectedBundle.get(name)));
  assertNoConflicts([...allCandidates.values()]);

  const registeredSources = new Map(state.sources.registrations.map(source => [source.name, source]));
  const declaredSources = new Map(bundle?.sources.map(source => [source.name, source]) ?? []);
  for (const declaration of declaredSources.values()) {
    const registered = registeredSources.get(declaration.name);
    if (registered && registered.url !== declaration.git) throw new HarnessError("SOURCE_MISMATCH", `Source URL differs for ${declaration.name}.`);
  }
  const snapshots = new Map(state.sources.snapshots.map(snapshot => [snapshot.id, snapshot]));
  for (const snapshot of index.snapshot.snapshots) {
    const existing = snapshots.get(snapshot.id);
    if (existing && canonicalJson(existing) !== canonicalJson(snapshot)) throw new HarnessError("SOURCE_MISMATCH", "Snapshot identity differs from stored provenance.");
    snapshots.set(snapshot.id, snapshot);
  }
  const adapters = new Map(state.adapters.registrations.map(adapter => [adapter.name, adapter]));
  const desired: DesiredAsset[] = [];
  for (const asset of allCandidates.values()) {
    const snapshot = snapshots.get(asset.snapshotId);
    if (!snapshot) throw new HarnessError("SOURCE_NOT_FOUND", `Source snapshot missing: ${asset.snapshotId}`);
    const registration = registeredSources.get(snapshot.tap);
    const declaration = declaredSources.get(snapshot.tap);
    if (registration && registration.url !== snapshot.url || declaration && declaration.git !== snapshot.url) {
      throw new HarnessError("SOURCE_MISMATCH", `Source URL differs for ${snapshot.tap}.`);
    }
    if (!registration && !declaration) throw new HarnessError("SOURCE_NOT_FOUND", `Source is not registered: ${snapshot.tap}`);
    const refs = requirements.filter(req => req.resolvedAssets.some(pin => pin.coordinate === asset.coordinate));
    const requestedPlacements = new Map(refs.flatMap(req => req.placements).map(value => [placementId(value), value]));
    const projected = sortBy([...requestedPlacements].map(([id, target]) => {
      const old = current.get(asset.coordinate);
      const alreadyApplied = old && sameVersion(asset, old) && state.install.operations.some(op => op.asset === asset.coordinate && op.placementIds.includes(id));
      if (!alreadyApplied) {
        if (!registration?.trusted) throw new HarnessError("SOURCE_UNTRUSTED", `Source is not trusted for activation: ${snapshot.tap}`, { asset: asset.coordinate });
        if (!adapters.has(target.target) || !asset.resolved?.manifest.targets.includes(target.target)) {
          throw new HarnessError("TARGET_UNSUPPORTED", `Asset cannot be projected to ${target.target}: ${asset.coordinate}`);
        }
      }
      return { placement: target, requirementIds: refs.filter(req => req.placements.some(value => placementId(value) === id)).map(req => req.id).sort() };
    }), value => placementId(value.placement));
    desired.push({ ...toPin(asset), snapshotId: asset.snapshotId, dependencies: asset.dependencies, conflicts: asset.conflicts,
      requirementIds: refs.map(req => req.id).sort(), placements: projected });
  }

  let bundleLock: BundleLock | undefined;
  if (bundle && bundleBinding) {
    const requiredAdapters = [...new Set(bundle.assets.flatMap(root => root.placements.map(value => value.target)))].sort();
    const signatures = requiredAdapters.map(name => {
      const adapter = adapters.get(name);
      if (!adapter) throw new HarnessError("TARGET_UNSUPPORTED", `Adapter not registered: ${name}`);
      return { name, version: adapter.version, signature: adapter.signature };
    });
    if (providedLock && canonicalJson(providedLock.adapterSignatures) !== canonicalJson(signatures)) throw new HarnessError("ADAPTER_CHANGED", "Adapter identity or content differs from the Bundle lock.");
    const usedSources = new Map<string, { name: string; url: string; commits: Map<string, Candidate["commit"]> }>();
    for (const asset of selectedBundle.values()) {
      const snapshot = snapshots.get(asset.snapshotId)!;
      if (!declaredSources.has(snapshot.tap)) throw new HarnessError("SOURCE_NOT_FOUND", `Bundle must declare dependency source: ${snapshot.tap}`);
      const source = usedSources.get(snapshot.tap) ?? { name: snapshot.tap, url: snapshot.url, commits: new Map() };
      source.commits.set(canonicalJson(asset.commit), asset.commit);
      usedSources.set(snapshot.tap, source);
    }
    bundleLock = parseBundleLock({ format: "harnessbrew.lock", version: 1, manifestDigest: bundleManifestDigest(bundle),
      roots: bundle.assets, adapterSignatures: signatures,
      sources: [...usedSources.values()].map(source => ({ name: source.name, url: source.url, commits: [...source.commits.values()] })),
      assets: [...selectedBundle.values()].map(asset => ({ ...toPin(asset), dependencies: asset.dependencies })) });
    if (providedLock && canonicalJson(providedLock) !== canonicalJson(bundleLock)) throw new HarnessError("LOCK_MISMATCH", "Locked dependency graph, inventory, or source identity does not match resolved content.");
  }
  return freezeData({ baseRevision: state.revision, owners: sortBy([...owners.values()], owner => owner.id),
    requirements: sortBy(requirements, req => req.id), assets: sortBy(desired, asset => asset.coordinate),
    orphanCoordinates: state.install.assets.filter(asset => !allCandidates.has(asset.coordinate)).map(asset => asset.coordinate).sort(),
    retained: [...released].filter(name => allCandidates.has(name)).sort().map(name => ({ coordinate: name, reason: "still-required" as const,
      ownerIds: [...new Set(requirements.filter(req => req.resolvedAssets.some(pin => pin.coordinate === name)).map(req => req.ownerId))].sort() })),
    requiredSources: sortBy([...(bundle?.sources ?? [])].map(source => ({ name: source.name, url: source.git })), source => source.name),
    ...(bundleLock ? { bundleLock } : {}) });
}
