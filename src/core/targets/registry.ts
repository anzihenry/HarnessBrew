import { HarnessBrewError } from "../errors.js";
import type { BuiltinTarget } from "../target-capabilities.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { codexAdapter } from "./codex.js";
import type { TargetAdapter } from "./types.js";

const adapters = new Map<BuiltinTarget, TargetAdapter>([
  [codexAdapter.name, codexAdapter],
  [claudeCodeAdapter.name, claudeCodeAdapter]
]);

export function getTargetAdapter(target: BuiltinTarget): TargetAdapter {
  const adapter = adapters.get(target);
  if (adapter === undefined) throw new HarnessBrewError(`Target adapter is not registered: ${target}`);
  return adapter;
}
