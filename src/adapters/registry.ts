import path from "node:path";
import { codexPlacement } from "./placement.js";
import type { AdapterProvider, AuthorizedAdapter, TargetAdapter } from "../domain/adapter.js";
import { assetKinds } from "../domain/assets.js";
import { freezeData } from "../domain/catalog.js";
import { HarnessError } from "../domain/errors.js";
import { digest, identifier, type Digest } from "../domain/identity.js";
import { oneOf, text, unique } from "../domain/validation.js";
import type { AppliedOperationType } from "../domain/state.js";
import { codexAdapter } from "./codex.js";

const capabilities = ["link-directory", "link-file", "write-file", "write-block", "set-config"] as const;
/** One registry per application instance. Registration never imports or installs a module. */
export class AdapterRegistry implements AdapterProvider {
  private readonly adapters = new Map<string, AuthorizedAdapter>();
  registerPlugin(adapter: TargetAdapter, signature: Digest, granted: readonly AppliedOperationType[], placementPolicy?: AuthorizedAdapter["resolvePlacement"]): void {
    if (adapter.name === "openai-codex" || granted.some(item => item !== "link-directory" && item !== "link-file")) {
      throw new HarnessError("CAPABILITY_DENIED", "Third-party adapters may request only link capabilities.");
    }
    this.add(adapter, signature, granted, placementPolicy);
  }
  registerCodex(signature: Digest, granted: readonly AppliedOperationType[] = capabilities): void { this.add(codexAdapter, signature, granted, codexPlacement); }
  private add(adapter: TargetAdapter, signature: Digest, granted: readonly AppliedOperationType[], placementPolicy?: AuthorizedAdapter["resolvePlacement"]): void {
    if (adapter.protocol !== "harnessbrew.adapter/1") throw new HarnessError("UNSUPPORTED_FORMAT", "Unsupported Adapter protocol.");
    const name = identifier(adapter.name);
    if (this.adapters.has(name)) throw new HarnessError("INVALID_ARGUMENT", `Adapter already registered: ${name}`);
    text(adapter.version, "adapter version"); digest(signature);
    unique([...adapter.supportedKinds].map(kind => oneOf(kind, assetKinds, "asset kind")), kind => kind, "supported kinds");
    unique([...granted].map(capability => oneOf(capability, capabilities, "capability")), capability => capability, "granted capabilities");
    if (adapter.requiredCapabilities.some(capability => !granted.includes(capability))) throw new HarnessError("CAPABILITY_DENIED", "Adapter requires capabilities that have not been granted.");
    if (typeof adapter.plan !== "function") throw new HarnessError("INVALID_ARGUMENT", "Adapter plan must be a function.");
    const resolvePlacement: AuthorizedAdapter["resolvePlacement"] = placementPolicy ?? ((placement, userHome) => {
      const root = placement.rootOverride ?? path.join(placement.projectRoot ?? userHome, `.${name}`);
      return { placement, roots: { config: root, skills: root, instructions: root }, authorizedRoots: [root] };
    });
    const captured: TargetAdapter = Object.freeze({ protocol: adapter.protocol, name, version: adapter.version,
      supportedKinds: Object.freeze([...adapter.supportedKinds]), requiredCapabilities: Object.freeze([...adapter.requiredCapabilities]), plan: adapter.plan.bind(adapter) });
    this.adapters.set(name, freezeData({ adapter: captured, signature, capabilities: [...granted], resolvePlacement }));
  }
  get(name: string): AuthorizedAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) throw new HarnessError("TARGET_UNSUPPORTED", `Adapter is unavailable: ${name}`);
    return adapter;
  }
}
