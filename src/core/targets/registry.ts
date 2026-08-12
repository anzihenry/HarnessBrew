import { HarnessBrewError } from "../errors.js";
import { formulaKinds } from "../formulas.js";
import { targetOperationKinds } from "../target-capabilities.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";
import { TARGET_ADAPTER_API_VERSION, type TargetAdapter, type TargetName } from "./types.js";

const adapters = new Map<TargetName, TargetAdapter>([
  [codexAdapter.name, codexAdapter],
  [claudeCodeAdapter.name, claudeCodeAdapter]
]);

export const TARGET_ADAPTER_VERSION = "1";

export function targetAdapterVersion(targets?: Iterable<TargetName>): string {
  const selected = targets === undefined
    ? listTargetAdapters()
    : [...new Set(targets)].map((target) => getTargetAdapter(target));
  const plugins = selected
    .filter((adapter) => adapter.name !== "openai-codex" && adapter.name !== "claude-code")
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((adapter) => `${adapter.name}@${adapter.version}`);
  return plugins.length === 0 ? TARGET_ADAPTER_VERSION : `${TARGET_ADAPTER_VERSION};${plugins.join(",")}`;
}

export function listTargetAdapters(): TargetAdapter[] {
  return [...adapters.values()].sort((left, right) => left.name.localeCompare(right.name));
}

export function hasTargetAdapter(target: string): boolean {
  return adapters.has(target);
}

export function registerTargetAdapter(adapter: TargetAdapter): () => void {
  if (adapter.apiVersion !== TARGET_ADAPTER_API_VERSION) {
    throw new HarnessBrewError(`Unsupported Target Adapter API version for ${adapter.name}: ${adapter.apiVersion}`);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(adapter.name)) {
    throw new HarnessBrewError(`Invalid Target Adapter name: ${adapter.name}`);
  }
  if (typeof adapter.version !== "string" || adapter.version.trim() === "" || /[,;@]/u.test(adapter.version)) {
    throw new HarnessBrewError(`Invalid Target Adapter version for ${adapter.name}.`);
  }
  if (adapters.has(adapter.name)) throw new HarnessBrewError(`Target adapter is already registered: ${adapter.name}`);
  for (const kind of formulaKinds) {
    if (!targetOperationKinds.includes(adapter.capabilities[kind])) {
      throw new HarnessBrewError(`Invalid ${kind} capability for Target Adapter ${adapter.name}.`);
    }
    if (!["unsupported", "symlink-file", "symlink-directory"].includes(adapter.capabilities[kind])) {
      throw new HarnessBrewError(
        `Target Adapter API v1 only supports symlink capabilities for third-party adapter ${adapter.name}.`
      );
    }
  }
  if (Object.keys(adapter.capabilities).some((kind) => !formulaKinds.includes(kind as typeof formulaKinds[number]))) {
    throw new HarnessBrewError(`Target Adapter ${adapter.name} contains an unknown Formula capability.`);
  }
  if (!["unsupported", "symlink-directory"].includes(adapter.capabilities.skill)) {
    throw new HarnessBrewError(`Target Adapter ${adapter.name} must install skills as complete directories.`);
  }
  const registered: TargetAdapter = Object.freeze({
    ...adapter,
    capabilities: Object.freeze({ ...adapter.capabilities }),
    plan: (
      receipt: Parameters<TargetAdapter["plan"]>[0],
      context?: Parameters<TargetAdapter["plan"]>[1]
    ) => adapter.plan.call(adapter, receipt, context)
  });
  adapters.set(adapter.name, registered);
  return () => { if (adapters.get(adapter.name) === registered) adapters.delete(adapter.name); };
}

export function getTargetAdapter(target: TargetName): TargetAdapter {
  const adapter = adapters.get(target);
  if (adapter === undefined) throw new HarnessBrewError(`Target adapter is not registered: ${target}`);
  return adapter;
}
