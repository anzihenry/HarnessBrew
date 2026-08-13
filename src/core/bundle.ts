import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { HarnessBrewError } from "./errors.js";
import { getFormula } from "./formulas.js";
import {
  installFormula,
  listInstalled,
  resolveDependencies,
  uninstallFormula,
  writeReceipt,
  type InstallReceipt
} from "./installations.js";
import { addTap, checkoutTap, listTaps, setTapTrust, updateTaps } from "./taps.js";
import { linkFormula, targetDestination, type LinkOptions, type TargetName } from "./targets.js";
import { removeTargetOperation } from "./targets/transaction.js";
import { hasTargetAdapter, targetAdapterVersion } from "./targets/registry.js";
import { upgradeFormulas } from "./upgrades.js";
import { captureMissingParents, captureTransactionPath, markTransactionPath, withJournalTransaction } from "./journal.js";

export interface HarnessTapDeclaration {
  name: string;
  git: string;
  ref?: string;
  trust?: boolean;
}

export interface HarnessAssetDeclaration {
  formula: string;
  targets: HarnessTargetDeclaration[];
}

export interface HarnessTargetDeclaration {
  target: TargetName;
  scope: "user" | "project";
  project?: string;
  root?: string;
}

export interface Harnessfile {
  schemaVersion: 1 | 2;
  taps: HarnessTapDeclaration[];
  assets: HarnessAssetDeclaration[];
}

export interface HarnessLockV1 {
  schemaVersion: 1;
  taps: Array<{ name: string; git: string; commit: string; ref?: string }>;
  assets: Array<{
    formula: string;
    commit: string;
    dependencies: string[];
    targets: string[];
  }>;
}

export interface HarnessLockV2 {
  schemaVersion: 2;
  manifestDigest: string;
  adapterVersion: string;
  taps: Array<{ name: string; git: string; commit: string; ref?: string }>;
  assets: Array<{
    formula: string;
    commit: string;
    digest: string;
    dependencies: string[];
    requested: boolean;
    targets: HarnessTargetDeclaration[];
  }>;
}

export type HarnessLock = HarnessLockV1 | HarnessLockV2;

export interface BundleOptions {
  targetRoots?: Partial<Record<TargetName, string>>;
  updateLock?: boolean;
}

export interface BundleCleanupResult {
  removed: string[];
  retained: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKeys(value: Record<string, unknown>, allowed: readonly string[], context: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) throw new HarnessBrewError(`Unknown ${context} field: ${unknown}`);
}

function targetDeclaration(value: unknown, context: string): HarnessTargetDeclaration {
  if (!isRecord(value)) throw new HarnessBrewError(`Invalid Target declaration for ${context}`);
  assertKeys(value, ["target", "scope", "project", "root"], `Target declaration for ${context}`);
  if (typeof value.target !== "string" || !hasTargetAdapter(value.target)) {
    throw new HarnessBrewError(`Invalid Target in ${context}`);
  }
  if (value.scope !== "user" && value.scope !== "project") {
    throw new HarnessBrewError(`Target scope must be user or project in ${context}`);
  }
  if (value.project !== undefined && (typeof value.project !== "string" || value.project.trim() === "")) {
    throw new HarnessBrewError(`Invalid Target project path in ${context}`);
  }
  if (value.root !== undefined && (typeof value.root !== "string" || value.root.trim() === "")) {
    throw new HarnessBrewError(`Invalid Target root path in ${context}`);
  }
  if (value.scope === "user" && value.project !== undefined) {
    throw new HarnessBrewError(`User Target cannot declare project in ${context}`);
  }
  if (value.scope === "project" && value.project === undefined) {
    throw new HarnessBrewError(`Project Target must declare project in ${context}`);
  }
  return {
    target: value.target,
    scope: value.scope,
    ...(value.project === undefined ? {} : { project: path.posix.normalize(value.project) }),
    ...(value.root === undefined ? {} : { root: path.posix.normalize(value.root) })
  };
}

function targetKey(target: HarnessTargetDeclaration): string {
  return JSON.stringify([target.target, target.scope, target.project ?? "", target.root ?? ""]);
}

export async function readHarnessfile(filePath: string): Promise<Harnessfile> {
  let raw: unknown;
  try {
    raw = parse(await readFile(filePath, "utf8"), { maxAliasCount: 20 });
  } catch (error) {
    throw new HarnessBrewError(`Invalid Harnessfile ${filePath}: ${(error as Error).message}`);
  }
  if (!isRecord(raw) || ((raw.schemaVersion ?? 1) !== 1 && raw.schemaVersion !== 2)) {
    throw new HarnessBrewError(`Unsupported Harnessfile schema: ${filePath}`);
  }
  const schemaVersion = (raw.schemaVersion ?? 1) as 1 | 2;
  if (schemaVersion === 2) assertKeys(raw, ["schemaVersion", "taps", "assets"], "Harnessfile");
  if (!Array.isArray(raw.taps) || !Array.isArray(raw.assets)) {
    throw new HarnessBrewError(`Harnessfile must contain taps and assets arrays: ${filePath}`);
  }
  const taps = raw.taps.map((item): HarnessTapDeclaration => {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.git !== "string") {
      throw new HarnessBrewError(`Invalid tap declaration in ${filePath}`);
    }
    if (schemaVersion === 2) assertKeys(item, ["name", "git", "ref", "trust"], `Tap ${item.name}`);
    if (item.git.trim() === "") throw new HarnessBrewError(`Invalid tap Git URL in ${filePath}`);
    if (item.ref !== undefined && (typeof item.ref !== "string" || item.ref.trim() === "")) {
      throw new HarnessBrewError(`Invalid tap ref in ${filePath}`);
    }
    if (item.trust !== undefined && typeof item.trust !== "boolean") {
      throw new HarnessBrewError(`Invalid tap trust policy in ${filePath}`);
    }
    return {
      name: item.name,
      git: item.git,
      ...(item.ref === undefined ? {} : { ref: item.ref }),
      ...(item.trust === undefined ? {} : { trust: item.trust })
    };
  });
  const assets = raw.assets.map((item): HarnessAssetDeclaration => {
    if (!isRecord(item) || typeof item.formula !== "string") {
      throw new HarnessBrewError(`Invalid asset declaration in ${filePath}`);
    }
    const formula = item.formula;
    if (schemaVersion === 2) assertKeys(item, ["formula", "targets"], `Asset ${formula}`);
    const declaredTargets = item.targets ?? [];
    if (!Array.isArray(declaredTargets)) {
      throw new HarnessBrewError(`Invalid asset targets for ${formula}`);
    }
    const targets = schemaVersion === 1
      ? declaredTargets.map((target): HarnessTargetDeclaration => {
        if (typeof target !== "string" || !hasTargetAdapter(target)) {
          throw new HarnessBrewError(`Invalid asset targets for ${formula}`);
        }
        return { target, scope: "user" };
      })
      : declaredTargets.map((target) => targetDeclaration(target, formula));
    if (new Set(targets.map(targetKey)).size !== targets.length) {
      throw new HarnessBrewError(`Harnessfile contains duplicate Target placements for ${formula}.`);
    }
    return { formula, targets };
  });
  if (new Set(taps.map((tap) => tap.name)).size !== taps.length) {
    throw new HarnessBrewError("Harnessfile contains duplicate taps.");
  }
  if (new Set(assets.map((asset) => asset.formula)).size !== assets.length) {
    throw new HarnessBrewError("Harnessfile contains duplicate assets.");
  }
  return { schemaVersion, taps, assets };
}

export function lockfilePath(harnessfilePath: string): string {
  return `${harnessfilePath}.lock`;
}

async function readLock(filePath: string): Promise<HarnessLock | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (!isRecord(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2)
      || !Array.isArray(value.taps) || !Array.isArray(value.assets)) throw new Error("shape");
    const validCommit = (commit: unknown): commit is string => typeof commit === "string" && /^[0-9a-f]{40}$/u.test(commit);
    const validDigest = (digest: unknown): digest is string => typeof digest === "string" && /^[0-9a-f]{64}$/u.test(digest);
    const validStrings = (items: unknown): items is string[] => Array.isArray(items)
      && items.every((item) => typeof item === "string");
    const taps = value.taps.map((item) => {
      if (!isRecord(item) || typeof item.name !== "string" || typeof item.git !== "string" || !validCommit(item.commit)
        || (item.ref !== undefined && typeof item.ref !== "string")) throw new Error("tap");
      if (value.schemaVersion === 2) assertKeys(item, ["name", "git", "commit", "ref"], `Lock Tap ${item.name}`);
      return {
        name: item.name,
        git: item.git,
        commit: item.commit,
        ...(item.ref === undefined ? {} : { ref: item.ref })
      };
    });
    if (new Set(taps.map((tap) => tap.name)).size !== taps.length) throw new Error("duplicate tap");
    if (value.schemaVersion === 1) {
      const assets = value.assets.map((item) => {
        if (!isRecord(item) || typeof item.formula !== "string" || !validCommit(item.commit)
          || !validStrings(item.dependencies) || !validStrings(item.targets)) throw new Error("asset");
        return { formula: item.formula, commit: item.commit, dependencies: item.dependencies, targets: item.targets };
      });
      return { schemaVersion: 1, taps, assets };
    }
    assertKeys(value, ["schemaVersion", "manifestDigest", "adapterVersion", "taps", "assets"], "Harnessfile lock");
    if (!validDigest(value.manifestDigest) || typeof value.adapterVersion !== "string" || value.adapterVersion === "") {
      throw new Error("metadata");
    }
    const assets = value.assets.map((item) => {
      if (!isRecord(item)) throw new Error("asset");
      assertKeys(item, ["formula", "commit", "digest", "dependencies", "requested", "targets"], "Lock asset");
      if (typeof item.formula !== "string" || !validCommit(item.commit) || !validDigest(item.digest)
        || !validStrings(item.dependencies) || typeof item.requested !== "boolean" || !Array.isArray(item.targets)) {
        throw new Error("asset");
      }
      const formula = item.formula;
      const targets = item.targets.map((target) => targetDeclaration(target, formula));
      if (new Set(targets.map(targetKey)).size !== targets.length) throw new Error("duplicate target");
      return {
        formula,
        commit: item.commit,
        digest: item.digest,
        dependencies: item.dependencies,
        requested: item.requested,
        targets
      };
    });
    if (new Set(assets.map((asset) => asset.formula)).size !== assets.length) throw new Error("duplicate asset");
    return {
      schemaVersion: 2,
      manifestDigest: value.manifestDigest,
      adapterVersion: value.adapterVersion,
      taps,
      assets
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new HarnessBrewError(`Invalid Harnessfile lock: ${filePath}`);
  }
}

async function writeLock(filePath: string, lock: HarnessLock): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await captureMissingParents(filePath);
  await captureTransactionPath(filePath);
  await captureTransactionPath(temporaryPath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(temporaryPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
  await markTransactionPath(filePath);
  await markTransactionPath(temporaryPath);
}

async function syncTaps(home: string, manifest: Harnessfile, lock: HarnessLock | undefined): Promise<void> {
  const registered = new Map((await listTaps(home)).map((tap) => [tap.name, tap]));
  for (const declaration of manifest.taps) {
    const existing = registered.get(declaration.name);
    if (existing !== undefined && existing.url !== declaration.git) {
      throw new HarnessBrewError(`Tap URL mismatch for ${declaration.name}: ${existing.url} != ${declaration.git}`);
    }
    const locked = lock?.taps.find((tap) => tap.name === declaration.name);
    if (locked !== undefined && locked.git !== declaration.git) {
      throw new HarnessBrewError(`Lockfile Tap URL mismatch for ${declaration.name}`);
    }
    if (existing === undefined) {
      await addTap(home, declaration.name, declaration.git, {
        ...(declaration.ref === undefined ? {} : { ref: declaration.ref }),
        trust: manifest.schemaVersion === 1 ? true : declaration.trust ?? false
      });
    } else if (locked === undefined) {
      if (existing.ref !== declaration.ref) {
        throw new HarnessBrewError(`Tap ref mismatch for ${declaration.name}; remove and re-add the tap.`);
      }
      await updateTaps(home, declaration.name);
    }
    if (manifest.schemaVersion === 2) {
      await setTapTrust(home, declaration.name, declaration.trust ?? false);
    }
    if (locked !== undefined) await checkoutTap(home, declaration.name, locked.commit);
  }
}

function canonicalTargets(targets: readonly HarnessTargetDeclaration[]): HarnessTargetDeclaration[] {
  return [...targets].sort((left, right) => targetKey(left).localeCompare(targetKey(right)));
}

function manifestDigest(manifest: Harnessfile): string {
  const normalized = {
    schemaVersion: manifest.schemaVersion,
    taps: [...manifest.taps].sort((left, right) => left.name.localeCompare(right.name)),
    assets: [...manifest.assets]
      .sort((left, right) => left.formula.localeCompare(right.formula))
      .map((asset) => ({ formula: asset.formula, targets: canonicalTargets(asset.targets) }))
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

function formulaDigest(receipt: InstallReceipt): string {
  const inventory = [...receipt.files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => [file.path, file.sha256, file.mode ?? null]);
  return createHash("sha256").update(JSON.stringify(inventory)).digest("hex");
}

function resolveDeclaredPath(harnessfilePath: string, declared: string): string {
  const resolved = path.resolve(path.dirname(harnessfilePath), declared);
  if (resolved === path.parse(resolved).root) {
    throw new HarnessBrewError(`Unsafe Harnessfile Target path: ${declared}`);
  }
  return resolved;
}

function placementOptions(
  harnessfilePath: string,
  declaration: HarnessTargetDeclaration,
  options: BundleOptions
): LinkOptions {
  const override = options.targetRoots?.[declaration.target];
  const resolvedOverride = override === undefined ? undefined : path.resolve(override);
  if (resolvedOverride !== undefined && resolvedOverride === path.parse(resolvedOverride).root) {
    throw new HarnessBrewError(`Unsafe Target root override: ${override}`);
  }
  return {
    scope: declaration.scope,
    ...(resolvedOverride !== undefined
      ? { root: resolvedOverride }
      : declaration.root === undefined ? {} : { root: resolveDeclaredPath(harnessfilePath, declaration.root) }),
    ...(declaration.project === undefined
      ? {} : { projectRoot: resolveDeclaredPath(harnessfilePath, declaration.project) })
  };
}

interface DesiredFormula {
  requested: boolean;
  targets: Map<string, HarnessTargetDeclaration>;
}

async function desiredFormulas(home: string, manifest: Harnessfile): Promise<Map<string, DesiredFormula>> {
  const desired = new Map<string, DesiredFormula>();
  for (const asset of manifest.assets) {
    const root = await getFormula(home, asset.formula);
    for (const formula of await resolveDependencies(home, root)) {
      const current = desired.get(formula.coordinate) ?? { requested: false, targets: new Map() };
      if (formula.coordinate === root.coordinate) current.requested = true;
      for (const target of asset.targets) current.targets.set(targetKey(target), target);
      desired.set(formula.coordinate, current);
    }
  }
  return desired;
}

async function reconcileTargets(
  home: string,
  harnessfilePath: string,
  receipt: InstallReceipt,
  desired: DesiredFormula,
  options: BundleOptions
): Promise<void> {
  const placements = [...desired.targets.values()].map((declaration) => ({
    declaration,
    options: placementOptions(harnessfilePath, declaration, options),
    destination: targetDestination(receipt, declaration.target, placementOptions(harnessfilePath, declaration, options))
  }));
  const destinations = new Set(placements.map((placement) => placement.destination));
  const removed = receipt.operations.filter((operation) => !destinations.has(operation.destination));
  for (const operation of [...removed].reverse()) await removeTargetOperation(operation);
  if (removed.length > 0 || receipt.requested !== desired.requested) {
    receipt.operations = receipt.operations.filter((operation) => !removed.includes(operation));
    receipt.links = receipt.links.filter((link) => destinations.has(link.path));
    receipt.targets = [...new Set(receipt.operations.map((operation) => operation.target))];
    receipt.requested = desired.requested;
    await writeReceipt(home, receipt);
  }
  for (const placement of placements) {
    await linkFormula(home, receipt.coordinate, placement.declaration.target, placement.options);
  }
}

function sameLock(left: HarnessLock, right: HarnessLock): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function bundleInstallInternal(
  home: string,
  harnessfilePath: string,
  options: BundleOptions
): Promise<HarnessLock> {
  const manifest = await readHarnessfile(harnessfilePath);
  const targetLockPath = lockfilePath(harnessfilePath);
  const existingLock = await readLock(targetLockPath);
  const digest = manifestDigest(manifest);
  const adapterVersion = targetAdapterVersion(
    manifest.assets.flatMap((asset) => asset.targets.map((target) => target.target))
  );
  if (options.updateLock !== true && existingLock !== undefined) {
    if (existingLock.schemaVersion !== manifest.schemaVersion) {
      throw new HarnessBrewError("Harnessfile and lockfile schema versions differ; use --update-lock.");
    }
    if (existingLock.schemaVersion === 2 && existingLock.manifestDigest !== digest) {
      throw new HarnessBrewError("Harnessfile changed since the lockfile was created; use --update-lock.");
    }
    if (existingLock.schemaVersion === 2 && existingLock.adapterVersion !== adapterVersion) {
      throw new HarnessBrewError(
        `Harnessfile lock requires adapter version ${existingLock.adapterVersion}; installed version is ${adapterVersion}. Use --update-lock.`
      );
    }
  }
  const resolutionLock = options.updateLock === true ? undefined : existingLock;
  await syncTaps(home, manifest, resolutionLock);

  for (const asset of manifest.assets) {
    await upgradeFormulas(home, asset.formula);
    await installFormula(home, asset.formula);
  }
  const desired = await desiredFormulas(home, manifest);
  let installed = new Map((await listInstalled(home)).map((receipt) => [receipt.coordinate, receipt]));
  for (const [coordinate, declaration] of [...desired].sort(([left], [right]) => left.localeCompare(right))) {
    const receipt = installed.get(coordinate);
    if (receipt === undefined) throw new HarnessBrewError(`Bundle formula was not installed: ${coordinate}`);
    await reconcileTargets(home, harnessfilePath, receipt, declaration, options);
  }
  installed = new Map((await listInstalled(home)).map((receipt) => [receipt.coordinate, receipt]));
  const resolved = [...desired.keys()].sort().map((coordinate) => {
    const receipt = installed.get(coordinate);
    if (receipt === undefined) throw new HarnessBrewError(`Bundle formula was not installed: ${coordinate}`);
    return receipt;
  });

  const taps = await listTaps(home);
  const lockedTaps = [...manifest.taps].sort((left, right) => left.name.localeCompare(right.name)).map((declaration) => {
    const tap = taps.find((candidate) => candidate.name === declaration.name);
    if (tap === undefined) throw new HarnessBrewError(`Tap was not synchronized: ${declaration.name}`);
    return {
      name: tap.name,
      git: tap.url,
      commit: tap.commit,
      ...(declaration.ref === undefined ? {} : { ref: declaration.ref })
    };
  });
  const lock: HarnessLock = manifest.schemaVersion === 1
    ? {
      schemaVersion: 1,
      taps: lockedTaps,
      assets: resolved.map((receipt) => ({
        formula: receipt.coordinate,
        commit: receipt.commit,
        dependencies: receipt.dependencies,
        targets: [...receipt.targets].sort()
      }))
    }
    : {
      schemaVersion: 2,
      manifestDigest: digest,
      adapterVersion,
      taps: lockedTaps,
      assets: resolved.map((receipt) => ({
        formula: receipt.coordinate,
        commit: receipt.commit,
        digest: formulaDigest(receipt),
        dependencies: [...receipt.dependencies].sort(),
        requested: desired.get(receipt.coordinate)?.requested ?? false,
        targets: canonicalTargets([...(desired.get(receipt.coordinate)?.targets.values() ?? [])])
      }))
    };
  if (resolutionLock !== undefined) {
    if (resolutionLock.schemaVersion === 2 && !sameLock(lock, resolutionLock)) {
      throw new HarnessBrewError("Installed bundle does not match Harnessfile.lock; use --update-lock to regenerate it.");
    }
    if (resolutionLock.schemaVersion === 1) {
      for (const asset of resolutionLock.assets) {
        const receipt = installed.get(asset.formula);
        if (receipt !== undefined && receipt.commit !== asset.commit) {
          throw new HarnessBrewError(`Locked commit mismatch for ${asset.formula}`);
        }
      }
    }
  }
  await writeLock(targetLockPath, lock);
  return lock;
}

export function bundleInstall(
  home: string,
  harnessfilePath: string,
  options: BundleOptions = {}
): Promise<HarnessLock> {
  return withJournalTransaction(home, "bundle:install", () => bundleInstallInternal(home, harnessfilePath, options));
}

async function desiredCoordinates(home: string, manifest: Harnessfile): Promise<Set<string>> {
  const desired = new Set<string>();
  for (const asset of manifest.assets) {
    const root = await getFormula(home, asset.formula);
    (await resolveDependencies(home, root)).forEach((formula) => desired.add(formula.coordinate));
  }
  return desired;
}

function removalOrder(receipts: InstallReceipt[]): InstallReceipt[] {
  const byCoordinate = new Map(receipts.map((receipt) => [receipt.coordinate, receipt]));
  const dependencies = new Set(
    receipts.flatMap((receipt) => receipt.dependencies.filter((dependency) => byCoordinate.has(dependency)))
  );
  const ordered: InstallReceipt[] = [];
  const visited = new Set<string>();
  function visit(receipt: InstallReceipt): void {
    if (visited.has(receipt.coordinate)) return;
    visited.add(receipt.coordinate);
    ordered.push(receipt);
    receipt.dependencies.forEach((dependency) => {
      const item = byCoordinate.get(dependency);
      if (item !== undefined) visit(item);
    });
  }
  const roots = receipts.filter((receipt) => !dependencies.has(receipt.coordinate));
  roots.sort((left, right) => left.coordinate.localeCompare(right.coordinate)).forEach(visit);
  receipts.sort((left, right) => left.coordinate.localeCompare(right.coordinate)).forEach(visit);
  return ordered;
}

async function bundleCleanupInternal(home: string, harnessfilePath: string): Promise<BundleCleanupResult> {
  const manifest = await readHarnessfile(harnessfilePath);
  const desired = await desiredCoordinates(home, manifest);
  const installed = await listInstalled(home);
  const candidates = installed.filter((receipt) => !desired.has(receipt.coordinate));
  const removed: string[] = [];
  for (const receipt of removalOrder(candidates)) {
    await uninstallFormula(home, receipt.coordinate);
    removed.push(receipt.coordinate);
  }
  return { removed, retained: installed.filter((receipt) => desired.has(receipt.coordinate)).map((receipt) => receipt.coordinate) };
}

export function bundleCleanup(home: string, harnessfilePath: string): Promise<BundleCleanupResult> {
  return withJournalTransaction(home, "bundle:cleanup", () => bundleCleanupInternal(home, harnessfilePath));
}

export async function removeLock(harnessfilePath: string): Promise<void> {
  const filePath = lockfilePath(harnessfilePath);
  await captureTransactionPath(filePath);
  await rm(filePath, { force: true });
  await markTransactionPath(filePath);
}
