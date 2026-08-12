import { homedir } from "node:os";
import path from "node:path";
import type { FormulaKind } from "../formulas.js";
import type { InstallReceipt } from "../installations.js";
import { parseCoordinate } from "../paths.js";
import { targetCapability } from "../target-capabilities.js";
import type { PlannedTargetOperation, TargetAdapter, TargetContext, TargetInstallPlan } from "./types.js";

function root(context: TargetContext): string {
  return path.resolve(context.root ?? path.join(homedir(), ".claude"));
}

function operation(receipt: InstallReceipt, context: TargetContext): PlannedTargetOperation[] {
  const kind = receipt.kind as FormulaKind;
  const strategy = targetCapability("claude-code", kind);
  if (strategy === "unsupported") return [];
  const [, , name] = parseCoordinate(receipt.coordinate);
  const targetRoot = root(context);
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
        return context.root === undefined
          ? path.join(homedir(), ".claude.json")
          : path.join(targetRoot, ".mcp.json");
      case "adapter":
        throw new Error("Unsupported adapter formula reached Claude Code planner.");
    }
  })();
  return [{ strategy, source, destination }];
}

export const claudeCodeAdapter: TargetAdapter = {
  name: "claude-code",
  supports: (kind) => targetCapability("claude-code", kind) !== "unsupported",
  plan(receipt, context = {}) {
    return {
      target: "claude-code",
      coordinate: receipt.coordinate,
      operations: operation(receipt, context)
    } satisfies TargetInstallPlan;
  }
};
