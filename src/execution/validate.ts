import { assembleState } from "./state.js";
import { placementId } from "../domain/placement.js";
import path from "node:path";
import type { AdapterProvider } from "../domain/adapter.js";
import { CatalogIndex } from "../domain/catalog-index.js";
import { HarnessError } from "../domain/errors.js";
import type { HomeState } from "../domain/home-state.js";
import { contained } from "../domain/identity.js";
import type { ChangePlan, FileUpdate } from "../domain/plan.js";
import { canonicalJson, unique } from "../domain/validation.js";
import { desiredFingerprint, editShared, precondition, resourceFingerprint } from "../planning/resources.js";
import { validateAdapterPlan } from "../planning/validate.js";
import { nodePlanningIO } from "../ports/planning.js";

const equal = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function invalid(message: string): never { throw new HarnessError("INVALID_PLAN", message); }
/** Checks executable payloads and recorded ownership without running Adapter plan() again. */
export async function validateExecution(plan: ChangePlan, before: HomeState, catalog: CatalogIndex, adapters: AdapterProvider, home: string): Promise<void> {
  for (const snapshot of plan.sourceSnapshots) {
    const registered = before.sources.snapshots.find(item => item.id === snapshot.id);
    const available = catalog.snapshot.snapshots.find(item => item.id === snapshot.id);
    if (registered && !equal(registered, snapshot) || available && !equal(available, snapshot) || !registered && !available) invalid("Plan snapshot differs from source evidence.");
  }
  assembleState(before, plan, before.revision, [...plan.expectedOperations.map(op => ({ id: op.id, asset: op.asset, type: op.operation.type,
    resource: op.operation.resource, placementIds: op.placementIds, requirementIds: op.requirementIds,
    installedFingerprint: op.installedFingerprint, createdDirectories: [] as string[] })), ...plan.retainedOperations]);
  unique(plan.operations, op => op.id, "execution operation IDs");
  unique(plan.fileUpdates, update => update.path, "execution file paths");
  unique(plan.expectedOperations, op => op.id, "expected operation IDs");
  const seen = new Set<string>();
  for (const op of plan.operations) {
    if (op.dependsOn.some(id => !seen.has(id))) invalid("Operations must be ordered after their dependencies.");
    seen.add(op.id);
    if (op.type === "remove-owned") {
      const previous = before.install.operations.find(item => item.id === op.existingOperationId);
      if (!previous || previous.asset !== op.asset || !equal(previous.resource, op.resource) || op.operation !== undefined) invalid("Removal must refer to an existing owned operation.");
      const actual = resourceFingerprint(await nodePlanningIO.inspect(op.resource.path), op.resource);
      if (actual.kind !== "missing" && !equal(actual, previous.installedFingerprint)) throw new HarnessError("TARGET_MODIFIED", "Removal target differs from recorded ownership.");
    } else {
      const expected = plan.expectedOperations.find(item => item.id === op.id);
      if (!expected || !equal(expected.operation, op.operation) || !equal(expected.operation.resource, op.resource) || expected.asset !== op.asset || expected.operation.type !== op.type || expected.contentDigest !== op.contentDigest || !equal(op.requiredCapabilities, [op.type])) invalid("Planned operation differs from expected ownership or payload.");
    }
  }
  for (const expected of plan.expectedOperations) {
    const asset = plan.desiredState.assets.find(asset => asset.coordinate === expected.asset);
    const resolved = asset && catalog.pinned(asset);
    if (!asset || !resolved || asset.contentDigest !== expected.contentDigest) invalid("Expected operation has no pinned inventory.");
    if (contained(home, expected.operation.resource.path) || contained(expected.operation.resource.path, home)) invalid("Targets cannot overlap Home.");
    const source = before.sources.registrations.find(item => item.name === expected.asset.split("/").slice(0, 2).join("/"));
    if (!source?.trusted) throw new HarnessError("SOURCE_UNTRUSTED", "Activation requires a trusted source.");
    for (const id of expected.placementIds) {
      const projection = asset.placements.find(item => placementId(item.placement) === id);
      if (!projection) invalid("Expected operation refers to an unknown placement.");
      const authorized = adapters.get(projection.placement.target);
      const registered = before.adapters.registrations.find(item => item.name === authorized.adapter.name);
      if (!registered || authorized.capabilities.some(capability => !registered.capabilities.includes(capability))) throw new HarnessError("CAPABILITY_DENIED", "Operation exceeds registered capabilities.");
      const target = authorized.resolvePlacement(projection.placement, plan.userHome);
      const roots = await Promise.all(target.authorizedRoots.map(async root => path.dirname((await nodePlanningIO.identify(path.join(root, ".harnessbrew-boundary"))).physicalPath)));
      validateAdapterPlan({ operations: [expected.operation] }, authorized, resolved, { ...target, authorizedRoots: roots });
    }
    const sourcePath = "sourceRelativePath" in expected.operation ? path.join(home, "content", expected.contentDigest.slice(7), expected.operation.sourceRelativePath) : "";
    if (!equal(desiredFingerprint(expected.operation, sourcePath), expected.installedFingerprint)) invalid("Expected fingerprint differs from operation payload.");
    const previous = before.install.operations.find(op => equal(op.resource, expected.operation.resource));
    const actual = resourceFingerprint(await nodePlanningIO.inspect(expected.operation.resource.path), expected.operation.resource);
    if (previous) {
      if (previous.asset !== expected.asset || previous.type !== expected.operation.type || expected.previousOperationId !== previous.id) invalid("Existing ownership cannot be transferred.");
      const repairing = plan.repair?.operationIds.includes(previous.id) && (actual.kind === "missing" || plan.repair.overwriteOwned && actual.kind === "file" && previous.resource.kind !== "path");
      if (!equal(actual, previous.installedFingerprint) && !repairing) throw new HarnessError("TARGET_MODIFIED", "Existing target differs from its installed fingerprint.");
    } else if (actual.kind !== "missing") throw new HarnessError("OWNERSHIP_CONFLICT", "Cannot overwrite an unowned resource.");
    if (!equal(actual, expected.installedFingerprint) && !plan.operations.some(op => op.id === expected.id && op.type !== "remove-owned")) invalid("Expected change has no executable operation.");
  }
  for (const retained of plan.retainedOperations) {
    const previous = before.install.operations.find(op => op.id === retained.id);
    if (!previous || !equal({ ...retained, placementIds: previous.placementIds, requirementIds: previous.requirementIds }, previous)) invalid("Retained operation differs from installed evidence.");
    if (!equal(resourceFingerprint(await nodePlanningIO.inspect(retained.resource.path), retained.resource), retained.installedFingerprint)) throw new HarnessError("TARGET_MODIFIED", "Retained resource changed.");
    const oldAsset = before.install.assets.find(asset => asset.coordinate === retained.asset), next = plan.desiredState.assets.find(asset => asset.coordinate === retained.asset);
    if (!oldAsset || !next || oldAsset.contentDigest !== next.contentDigest) invalid("Retained content version changed.");
  }
  const groups = new Set<string>();
  const covered = new Set<string>();
  for (const update of plan.fileUpdates) {
    if (groups.has(update.id) || update.dependsOn.some(id => !groups.has(id))) invalid("Invalid file group ordering."); groups.add(update.id);
    const current = await nodePlanningIO.inspect(update.path);
    if (!equal(precondition(current), update.before) || !plan.preconditions.some(item => equal(item, update.before))) throw new HarnessError("PLAN_STALE", "File group has no matching current precondition.");
    const operations = update.operationIds.map(id => {
      const op = plan.operations.find(item => item.id === id);
      if (!op || op.resource.path !== update.path || covered.has(id)) invalid("File group contains an unknown or repeated operation.");
      covered.add(id);
      if (!equal(resourceFingerprint(current, op.resource), op.expectedBefore)) throw new HarnessError("PLAN_STALE", "Operation resource changed.");
      return op;
    });
    if (!operations.length) invalid("Empty file update group.");
    let expected: FileUpdate["after"];
    if (operations.every(op => op.resource.kind !== "path")) {
      if (current.kind !== "file" && current.kind !== "missing") invalid("Shared update requires a regular file.");
      let content = current.kind === "file" ? current.content : "";
      for (const op of operations) content = editShared(content, op.resource, op.operation);
      expected = { kind: "file", content, mode: current.kind === "file" ? current.mode : 0o644 };
    } else {
      if (operations.length !== 1) invalid("Exclusive resource has multiple operations.");
      const op = operations[0]!;
      if (op.type === "remove-owned") expected = { kind: "missing" };
      else if (op.operation?.type === "write-file") expected = { kind: "file", content: op.operation.content, mode: op.operation.mode };
      else {
        const fingerprint = plan.expectedOperations.find(item => item.id === op.id)?.installedFingerprint;
        if (fingerprint?.kind !== "symlink") invalid("Link has no source fingerprint.");
        expected = { kind: "symlink", target: fingerprint.target };
      }
    }
    if (!equal(expected, update.after)) invalid("File update differs from the validated operation payloads.");
  }
  for (const op of plan.operations) if (!covered.has(op.id) && (op.type !== "remove-owned" || (await nodePlanningIO.inspect(op.resource.path)).kind !== "missing")) {
    // A shared key can already be absent while the containing user file remains intact.
    if (op.type !== "remove-owned" || resourceFingerprint(await nodePlanningIO.inspect(op.resource.path), op.resource).kind !== "missing") invalid("Changed operation is missing a file update.");
  }
}
