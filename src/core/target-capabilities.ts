import type { FormulaKind } from "./formulas.js";

export const builtinTargets = ["openai-codex", "claude-code"] as const;
export type BuiltinTarget = (typeof builtinTargets)[number];

export const targetOperationKinds = [
  "symlink-directory",
  "symlink-file",
  "render-file",
  "render-skill",
  "merge-config",
  "managed-block",
  "unsupported"
] as const;

export type TargetOperationKind = (typeof targetOperationKinds)[number];
export type TargetCapabilityMatrix = Record<BuiltinTarget, Record<FormulaKind, TargetOperationKind>>;

export const targetCapabilities = {
  "openai-codex": {
    skill: "symlink-directory",
    agent: "render-file",
    workflow: "render-skill",
    instruction: "managed-block",
    prompt: "render-skill",
    mcp: "merge-config",
    adapter: "unsupported"
  },
  "claude-code": {
    skill: "symlink-directory",
    agent: "render-file",
    workflow: "render-skill",
    instruction: "symlink-file",
    prompt: "render-skill",
    mcp: "merge-config",
    adapter: "unsupported"
  }
} as const satisfies TargetCapabilityMatrix;

export function targetCapability(target: BuiltinTarget, kind: FormulaKind): TargetOperationKind {
  return targetCapabilities[target][kind];
}
