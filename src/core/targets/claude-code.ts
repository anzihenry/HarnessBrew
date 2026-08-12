import { homedir } from "node:os";
import path from "node:path";
import type { FormulaKind } from "../formulas.js";
import type { InstallReceipt } from "../installations.js";
import { parseCoordinate } from "../paths.js";
import { targetCapability } from "../target-capabilities.js";
import type { PlannedTargetOperation, TargetAdapter, TargetContext, TargetInstallPlan } from "./types.js";

function roots(context: TargetContext): { target: string; project?: string } {
  if (context.root !== undefined) return { target: path.resolve(context.root) };
  if (context.scope === "project") {
    if (context.projectRoot === undefined) throw new Error("Claude Code project scope requires a project root.");
    const project = path.resolve(context.projectRoot);
    return { target: path.join(project, ".claude"), project };
  }
  return { target: path.join(homedir(), ".claude") };
}

function operation(receipt: InstallReceipt, context: TargetContext): PlannedTargetOperation[] {
  const kind = receipt.kind as FormulaKind;
  const strategy = targetCapability("claude-code", kind);
  if (strategy === "unsupported") return [];
  const [, , name] = parseCoordinate(receipt.coordinate);
  const targetRoots = roots(context);
  const targetRoot = targetRoots.target;
  const source = strategy === "symlink-directory"
    ? receipt.cellarPath
    : path.join(receipt.cellarPath, receipt.entry);
  const destination = (() => {
    switch (kind) {
      case "skill":
      case "workflow":
      case "prompt":
        return path.join(targetRoot, "skills", name);
      case "agent":
        return path.join(targetRoot, "agents", `${name}.md`);
      case "instruction":
        return path.join(targetRoot, "rules", `${name}.md`);
      case "mcp":
        return targetRoots.project !== undefined
          ? path.join(targetRoots.project, ".mcp.json")
          : context.root === undefined
            ? path.join(homedir(), ".claude.json")
            : path.join(targetRoot, ".mcp.json");
      case "adapter":
        throw new Error("Unsupported adapter formula reached Claude Code planner.");
    }
  })();
  return [{ strategy, source, destination }];
}

export const claudeCodeAdapter: TargetAdapter = {
  apiVersion: 1,
  name: "claude-code",
  version: "1",
  capabilities: {
    skill: targetCapability("claude-code", "skill"),
    agent: targetCapability("claude-code", "agent"),
    workflow: targetCapability("claude-code", "workflow"),
    instruction: targetCapability("claude-code", "instruction"),
    prompt: targetCapability("claude-code", "prompt"),
    mcp: targetCapability("claude-code", "mcp"),
    adapter: targetCapability("claude-code", "adapter")
  },
  plan(receipt, context = {}) {
    return {
      target: "claude-code",
      coordinate: receipt.coordinate,
      operations: operation(receipt, context)
    } satisfies TargetInstallPlan;
  }
};
