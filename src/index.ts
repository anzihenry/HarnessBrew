export { runCli, type CliIO, type CliJsonEnvelope, type CliJsonError, type CliOptions } from "./cli.js";
export { addTap, assertTapTrusted, listTaps, removeTap, setTapTrust, updateTaps } from "./core/taps.js";
export type { AddTapOptions, TapUpdate, UpdateTapOptions } from "./core/taps.js";
export { getFormula, loadCatalog, searchFormulas, validateTapRepository } from "./core/formulas.js";
export type { CatalogFormula, Formula, FormulaKind, FormulaSearchOptions } from "./core/formulas.js";
export { installFormula, listInstalled, readReceipt, resolveDependencies, uninstallFormula } from "./core/installations.js";
export type { InstallReceipt, InstalledFile, InstalledLink, UninstallOptions } from "./core/installations.js";
export { builtinTargets, installForTarget, linkFormula, targetDestination, unlinkFormula } from "./core/targets.js";
export type { BuiltinTarget, LinkOptions, TargetScope, UnlinkOptions } from "./core/targets.js";
export { targetCapabilities, targetCapability, targetOperationKinds } from "./core/target-capabilities.js";
export type { TargetCapabilityMatrix, TargetOperationKind } from "./core/target-capabilities.js";
export { planTargetInstall } from "./core/targets/planner.js";
export {
  getTargetAdapter,
  hasTargetAdapter,
  listTargetAdapters,
  registerTargetAdapter,
  targetAdapterVersion,
  TARGET_ADAPTER_VERSION
} from "./core/targets/registry.js";
export type {
  PlannedTargetOperation,
  TargetAdapter,
  TargetName,
  TargetContext,
  TargetInstallPlan
} from "./core/targets/types.js";
export { TARGET_ADAPTER_API_VERSION } from "./core/targets/types.js";
export {
  addAdapterPlugin,
  listAdapterPlugins,
  loadAdapterPlugins,
  removeAdapterPlugin
} from "./core/adapter-plugins.js";
export type { AdapterPluginRecord } from "./core/adapter-plugins.js";
export { findOutdated, upgradeFormulas } from "./core/upgrades.js";
export type { OutdatedFormula, UpgradeResult } from "./core/upgrades.js";
export { doctor, relinkFormula } from "./core/doctor.js";
export { homeLockPath, targetLockPath, withFileLock, withHomeLock, withTargetLock } from "./core/locks.js";
export type { LockOptions } from "./core/locks.js";
export {
  captureMissingParents,
  captureTransactionPath,
  markTransactionPath,
  recoverTransactions,
  transactionsRoot,
  withJournalPreview,
  withJournalTransaction
} from "./core/journal.js";
export type {
  PathFingerprint,
  RecoveryResult,
  SnapshotKind,
  TransactionChange,
  TransactionPreview
} from "./core/journal.js";
export type { DoctorFinding, DoctorFindingKind, DoctorReport, RelinkOptions } from "./core/doctor.js";
export { bundleCleanup, bundleInstall, lockfilePath, readHarnessfile } from "./core/bundle.js";
export type {
  BundleCleanupResult,
  BundleOptions,
  HarnessAssetDeclaration,
  HarnessLock,
  HarnessLockV1,
  HarnessLockV2,
  HarnessTargetDeclaration,
  HarnessTapDeclaration,
  Harnessfile
} from "./core/bundle.js";
export type { TapRecord } from "./core/state.js";
export { VERSION } from "./version.js";
