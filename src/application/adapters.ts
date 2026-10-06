import { createHash, randomUUID } from "node:crypto";
import { cp, readFile, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AdapterRegistry } from "../adapters/registry.js";
import type { AuthorizedAdapter, TargetAdapter } from "../domain/adapter.js";
import type { AdapterRegistration, HomeState } from "../domain/home-state.js";
import type { AppliedOperationType } from "../domain/state.js";
import { digest, relativePath } from "../domain/identity.js";
import { placementId } from "../domain/placement.js";
import { canonicalJson, format } from "../domain/validation.js";
import { HarnessError } from "../domain/errors.js";
import { inspectContent } from "../sources/inventory.js";
import { cacheDirectory } from "./cache.js";
import { withFileLock } from "../transactions/file-lock.js";
import { exists } from "../execution/files.js";

export async function builtinRegistration(): Promise<AdapterRegistration> {
  const identity = await builtinIdentity();
  const registry = new AdapterRegistry(); registry.registerCodex(identity.signature);
  const value = registry.get("openai-codex");
  return { name: value.adapter.name, module: "builtin:codex", protocol: value.adapter.protocol, version: value.adapter.version, signature: value.signature, capabilities: [...value.capabilities] };
}
export async function inspectPlugin(module: string, capabilities: readonly AppliedOperationType[]): Promise<AdapterRegistration> {
  const root = await realpath(module), inventory = await inspectContent(root);
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const dependencies = { ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.optionalDependencies };
  if (Object.keys(dependencies).length && !inventory.entries.some(item => item.path === "package-lock.json" && item.type === "file")) throw new HarnessError("INVALID_ARGUMENT", "Plugin dependencies require an included package-lock.json.");
  for (const name of Object.keys(dependencies)) {
    if (!inventory.entries.some(item => item.path === `node_modules/${name}/package.json` && item.type === "file")) throw new HarnessError("INVALID_ARGUMENT", "Plugin dependencies must be installed inside the signed package directory.", { dependency: name });
  }
  const declaration = format(pkg.harnessbrew, "harnessbrew.adapter-package", ["name", "adapterVersion", "entry"]);
  const entry = relativePath(declaration.entry);
  if (!inventory.entries.some(item => item.path === entry && item.type === "file")) throw new HarnessError("INVALID_ARGUMENT", "Adapter entry is missing.");
  if (capabilities.some(value => value !== "link-directory" && value !== "link-file")) throw new HarnessError("CAPABILITY_DENIED", "Plugins can only request link capabilities.");
  if (typeof declaration.name !== "string" || typeof declaration.adapterVersion !== "string") throw new HarnessError("INVALID_ARGUMENT", "Invalid adapter declaration.");
  return { name: declaration.name, module: root, protocol: "harnessbrew.adapter/1", version: declaration.adapterVersion, signature: inventory.digest, capabilities: [...capabilities] };
}
export async function registryFor(state: HomeState, cache: string, supplied: readonly AuthorizedAdapter[], load = true, needed?: ReadonlySet<string>): Promise<AdapterRegistry> {
  const registry = new AdapterRegistry(), builtin = await builtinRegistration();
  for (const registration of state.adapters.registrations) {
    if (needed && !needed.has(registration.name)) continue;
    if (registration.module === "builtin:codex") {
      if (registration.signature !== builtin.signature) throw new HarnessError("ADAPTER_CHANGED", "Built-in adapter changed; explicitly register the current built-in adapter.");
      registry.registerCodex(builtin.signature); continue;
    }
    const provided = supplied.find(value => value.adapter.name === registration.name);
    if (provided) {
      if (provided.signature !== registration.signature || provided.adapter.version !== registration.version) throw new HarnessError("ADAPTER_CHANGED", "Supplied adapter changed.");
      registry.registerPlugin(provided.adapter, provided.signature, registration.capabilities as AppliedOperationType[], provided.resolvePlacement); continue;
    }
    const current = await inspectPlugin(registration.module, registration.capabilities as AppliedOperationType[]);
    if (canonicalJson(current) !== canonicalJson(registration)) throw new HarnessError("ADAPTER_CHANGED", "Plugin package changed before import.", { adapter: registration.name });
    if (!load) continue;
    const destination = path.join(cache, "plugins", registration.signature.slice(7));
    await cacheDirectory(cache, "plugins");
    await withFileLock(`${destination}.lock`, async () => {
      if (await exists(destination)) return;
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await cp(registration.module, temporary, { recursive: true, errorOnExist: true, force: false });
        if ((await inspectContent(temporary)).digest !== registration.signature) throw new HarnessError("ADAPTER_CHANGED", "Plugin changed while copying authorized content.");
        await rename(temporary, destination);
      } finally { await rm(temporary, { recursive: true, force: true }); }
    });
    if ((await inspectContent(destination)).digest !== registration.signature) throw new HarnessError("ADAPTER_CHANGED", "Plugin cache differs from authorized package.");
    const pkg = JSON.parse(await readFile(path.join(destination, "package.json"), "utf8"));
    const loaded = await import(pathToFileURL(path.join(destination, relativePath(pkg.harnessbrew.entry))).href) as { default?: TargetAdapter };
    if (!loaded.default || loaded.default.name !== registration.name || loaded.default.version !== registration.version) throw new HarnessError("ADAPTER_CHANGED", "Plugin export differs from its declaration.");
    registry.registerPlugin(loaded.default, registration.signature, registration.capabilities as AppliedOperationType[]);
  }
  return registry;
}

/** Recheck original and loaded cache bytes without importing code under transaction locks. */
export async function verifyRegistryFiles(state: HomeState, cache: string, supplied: readonly AuthorizedAdapter[], needed?: ReadonlySet<string>): Promise<void> {
  await registryFor(state, cache, supplied, false, needed);
  for (const registration of state.adapters.registrations) {
    if (needed && !needed.has(registration.name) || registration.module === "builtin:codex" || supplied.some(a => a.adapter.name === registration.name)) continue;
    if ((await inspectContent(path.join(cache, "plugins", registration.signature.slice(7)))).digest !== registration.signature) throw new HarnessError("ADAPTER_CHANGED", "Loaded adapter cache changed before commit.");
  }
}

export async function builtinIdentity(): Promise<{ signature: import("../domain/identity.js").Digest; coverage: { file: string; sha256: string }[]; rule: string }> {
  const value = JSON.parse(await readFile(fileURLToPath(new URL("../adapter-identity.json", import.meta.url)), "utf8"));
  if (value.rule !== "harnessbrew.builtin-closure/1" || !Array.isArray(value.coverage)) throw new HarnessError("ADAPTER_CHANGED", "Invalid built-in identity manifest.");
  for (const entry of value.coverage) {
    const bytes = await readFile(fileURLToPath(new URL(`../${relativePath(entry.file)}`, import.meta.url)), "utf8");
    if (createHash("sha256").update(bytes.replace(/^\/\/# sourceMappingURL=.*$/gm, "")).digest("hex") !== entry.sha256) throw new HarnessError("ADAPTER_CHANGED", "Built-in runtime differs from its build identity.");
  }
  const actual = `sha256:${createHash("sha256").update(JSON.stringify({ rule: value.rule, coverage: value.coverage, dependencies: value.dependencies })).digest("hex")}`;
  if (actual !== value.signature) throw new HarnessError("ADAPTER_CHANGED", "Built-in identity manifest is inconsistent.");
  return { signature: digest(value.signature), coverage: value.coverage, rule: value.rule };
}

/** Static candidate inspection never imports candidate code. Capability requirements in
 * legacy plugin packages are only known after explicitly authorized loading. */
export async function inspectAdapterCandidate(state: HomeState, name: string, module: string): Promise<import("./types.js").AdapterUpgradeInspection> {
  const current = state.adapters.registrations.find(a => a.name === name);
  if (!current) throw new HarnessError("TARGET_UNSUPPORTED", "Adapter is not registered.", { adapter: name });
  const candidate = module === "builtin:codex" ? await builtinRegistration() : await inspectPlugin(module, current.capabilities.filter(c => c === "link-file" || c === "link-directory") as AppliedOperationType[]);
  if (candidate.name !== name) throw new HarnessError("ADAPTER_CHANGED", "Candidate name differs from the registered adapter.");
  if ((current.module === "builtin:codex") !== (candidate.module === "builtin:codex")) throw new HarnessError("CAPABILITY_DENIED", "Cannot replace a built-in adapter with plugin code or conversely.");
  const inventory = module === "builtin:codex" ? undefined : await inspectContent(candidate.module);
  if (inventory && inventory.digest !== candidate.signature) throw new HarnessError("ADAPTER_CHANGED", "Candidate changed during inspection.");
  return {
    current, candidate,
    signatureCoverage: inventory ? inventory.entries.map(e => e.path) : (await builtinIdentity()).coverage.map(e => e.file).concat("production dependency lock entries"),
    signatureRule: inventory ? "harnessbrew.content/1" : (await builtinIdentity()).rule,
    allowedCapabilities: module === "builtin:codex" ? candidate.capabilities as AppliedOperationType[] : ["link-directory", "link-file"],
    requiredCapabilities: module === "builtin:codex" ? ["link-directory", "write-file", "write-block", "set-config"] : null,
    affectedAssets: [...new Map(state.install.requirements.flatMap(r => r.placements.filter(p => p.target === name).flatMap(p => r.resolvedAssets.map(a => ({ asset: a.coordinate, placementId: placementId(p) })))).map(a => [`${a.asset}:${a.placementId}`, a])).values()],
    affectedBindings: state.install.owners.filter(o => o.kind === "bundle" && state.install.requirements.some(r => r.ownerId === o.id && r.placements.some(p => p.target === name))).map(o => o.id)
  };
}