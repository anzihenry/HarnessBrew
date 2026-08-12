import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { HarnessBrewError } from "./errors.js";
import { getFormula } from "./formulas.js";
import { installFormula, listInstalled, resolveDependencies, uninstallFormula, type InstallReceipt } from "./installations.js";
import { addTap, checkoutTap, listTaps, updateTaps } from "./taps.js";
import { builtinTargets, installForTarget, linkFormula, type BuiltinTarget } from "./targets.js";
import { upgradeFormulas } from "./upgrades.js";
import { captureMissingParents, captureTransactionPath, markTransactionPath } from "./journal.js";

export interface HarnessTapDeclaration {
  name: string;
  git: string;
  ref?: string;
}

export interface HarnessAssetDeclaration {
  formula: string;
  targets: BuiltinTarget[];
}

export interface Harnessfile {
  schemaVersion: 1;
  taps: HarnessTapDeclaration[];
  assets: HarnessAssetDeclaration[];
}

export interface HarnessLock {
  schemaVersion: 1;
  taps: Array<{ name: string; git: string; commit: string; ref?: string }>;
  assets: Array<{
    formula: string;
    commit: string;
    dependencies: string[];
    targets: string[];
  }>;
}

export interface BundleOptions {
  targetRoots?: Partial<Record<BuiltinTarget, string>>;
}

export interface BundleCleanupResult {
  removed: string[];
  retained: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readHarnessfile(filePath: string): Promise<Harnessfile> {
  let raw: unknown;
  try {
    raw = parse(await readFile(filePath, "utf8"), { maxAliasCount: 20 });
  } catch (error) {
    throw new HarnessBrewError(`Invalid Harnessfile ${filePath}: ${(error as Error).message}`);
  }
  if (!isRecord(raw) || (raw.schemaVersion ?? 1) !== 1) {
    throw new HarnessBrewError(`Unsupported Harnessfile schema: ${filePath}`);
  }
  if (!Array.isArray(raw.taps) || !Array.isArray(raw.assets)) {
    throw new HarnessBrewError(`Harnessfile must contain taps and assets arrays: ${filePath}`);
  }
  const taps = raw.taps.map((item): HarnessTapDeclaration => {
    if (!isRecord(item) || typeof item.name !== "string" || typeof item.git !== "string") {
      throw new HarnessBrewError(`Invalid tap declaration in ${filePath}`);
    }
    if (item.ref !== undefined && typeof item.ref !== "string") {
      throw new HarnessBrewError(`Invalid tap ref in ${filePath}`);
    }
    return { name: item.name, git: item.git, ...(item.ref === undefined ? {} : { ref: item.ref }) };
  });
  const assets = raw.assets.map((item): HarnessAssetDeclaration => {
    if (!isRecord(item) || typeof item.formula !== "string") {
      throw new HarnessBrewError(`Invalid asset declaration in ${filePath}`);
    }
    const targets = item.targets ?? [];
    if (!Array.isArray(targets) || targets.some((target) => !builtinTargets.includes(target as BuiltinTarget))) {
      throw new HarnessBrewError(`Invalid asset targets for ${item.formula}`);
    }
    return { formula: item.formula, targets: [...new Set(targets as BuiltinTarget[])] };
  });
  if (new Set(taps.map((tap) => tap.name)).size !== taps.length) {
    throw new HarnessBrewError("Harnessfile contains duplicate taps.");
  }
  if (new Set(assets.map((asset) => asset.formula)).size !== assets.length) {
    throw new HarnessBrewError("Harnessfile contains duplicate assets.");
  }
  return { schemaVersion: 1, taps, assets };
}

export function lockfilePath(harnessfilePath: string): string {
  return `${harnessfilePath}.lock`;
}

async function readLock(filePath: string): Promise<HarnessLock | undefined> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as HarnessLock;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.taps) || !Array.isArray(parsed.assets)) throw new Error("shape");
    return parsed;
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
      const ref = locked?.commit ?? declaration.ref;
      await addTap(home, declaration.name, declaration.git, ref === undefined ? {} : { ref });
    } else if (locked === undefined) {
      if (existing.ref !== declaration.ref) {
        throw new HarnessBrewError(`Tap ref mismatch for ${declaration.name}; remove and re-add the tap.`);
      }
      await updateTaps(home, declaration.name);
    }
    if (locked !== undefined) await checkoutTap(home, declaration.name, locked.commit);
  }
}

function rootOptions(target: BuiltinTarget, options: BundleOptions): { root?: string } {
  const root = options.targetRoots?.[target];
  return root === undefined ? {} : { root };
}

export async function bundleInstall(
  home: string,
  harnessfilePath: string,
  options: BundleOptions = {}
): Promise<HarnessLock> {
  const manifest = await readHarnessfile(harnessfilePath);
  const targetLockPath = lockfilePath(harnessfilePath);
  const existingLock = await readLock(targetLockPath);
  await syncTaps(home, manifest, existingLock);

  const resolved = new Map<string, InstallReceipt>();
  for (const asset of manifest.assets) {
    await upgradeFormulas(home, asset.formula);
    const receipts = asset.targets.length === 0
      ? await installFormula(home, asset.formula)
      : await installForTarget(home, asset.formula, asset.targets[0] as BuiltinTarget, rootOptions(asset.targets[0] as BuiltinTarget, options));
    for (const target of asset.targets.slice(1)) {
      for (const receipt of receipts) await linkFormula(home, receipt.coordinate, target, rootOptions(target, options));
    }
    receipts.forEach((receipt) => resolved.set(receipt.coordinate, receipt));
  }

  if (existingLock !== undefined) {
    for (const asset of existingLock.assets) {
      const receipt = resolved.get(asset.formula);
      if (receipt !== undefined && receipt.commit !== asset.commit) {
        throw new HarnessBrewError(`Locked commit mismatch for ${asset.formula}`);
      }
    }
  }

  const taps = await listTaps(home);
  const lock: HarnessLock = {
    schemaVersion: 1,
    taps: manifest.taps.map((declaration) => {
      const tap = taps.find((candidate) => candidate.name === declaration.name);
      if (tap === undefined) throw new HarnessBrewError(`Tap was not synchronized: ${declaration.name}`);
      return {
        name: tap.name,
        git: tap.url,
        commit: tap.commit,
        ...(declaration.ref === undefined ? {} : { ref: declaration.ref })
      };
    }),
    assets: [...resolved.values()].sort((left, right) => left.coordinate.localeCompare(right.coordinate)).map((receipt) => ({
      formula: receipt.coordinate,
      commit: receipt.commit,
      dependencies: receipt.dependencies,
      targets: receipt.targets
    }))
  };
  await writeLock(targetLockPath, lock);
  return lock;
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
  receipts.forEach(visit);
  return ordered;
}

export async function bundleCleanup(home: string, harnessfilePath: string): Promise<BundleCleanupResult> {
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

export async function removeLock(harnessfilePath: string): Promise<void> {
  const filePath = lockfilePath(harnessfilePath);
  await captureTransactionPath(filePath);
  await rm(filePath, { force: true });
  await markTransactionPath(filePath);
}
