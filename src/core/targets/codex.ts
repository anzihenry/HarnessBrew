import { homedir } from "node:os";
import path from "node:path";
import type { FormulaKind } from "../formulas.js";
import type { InstallReceipt } from "../installations.js";
import { targetCapability } from "../target-capabilities.js";
import { parseCoordinate } from "../paths.js";
import type { PlannedTargetOperation, TargetAdapter, TargetContext, TargetInstallPlan } from "./types.js";

function roots(context: TargetContext): { codex: string; agents: string; project?: string } {
  if (context.root !== undefined) {
    const root = path.resolve(context.root);
    return { codex: root, agents: root };
  }
  if (context.scope === "project") {
    if (context.projectRoot === undefined) throw new Error("Codex project scope requires a project root.");
    const project = path.resolve(context.projectRoot);
    return {
      codex: path.join(project, ".codex"),
      agents: path.join(project, ".agents"),
      project
    };
  }
  return {
    codex: path.join(homedir(), ".codex"),
    agents: path.join(homedir(), ".agents")
  };
}

function operation(receipt: InstallReceipt, context: TargetContext): PlannedTargetOperation[] {
  const kind = receipt.kind as FormulaKind;
  const strategy = targetCapability("openai-codex", kind);
  if (strategy === "unsupported") return [];
  const [, , name] = parseCoordinate(receipt.coordinate);
  const targetRoots = roots(context);
  const source = strategy === "symlink-directory"
    ? receipt.cellarPath
    : path.join(receipt.cellarPath, receipt.entry);
  const destination = (() => {
    switch (kind) {
      case "skill":
      case "workflow":
      case "prompt":
        return path.join(targetRoots.agents, "skills", name);
      case "agent":
        return path.join(targetRoots.codex, "agents", `${name}.toml`);
      case "instruction":
        return path.join(targetRoots.project ?? targetRoots.codex, "AGENTS.md");
      case "mcp":
        return path.join(targetRoots.codex, "config.toml");
      case "adapter":
        throw new Error("Unsupported adapter formula reached Codex planner.");
    }
  })();
  return [{ strategy, source, destination }];
}

export const codexAdapter: TargetAdapter = {
  name: "openai-codex",
  supports: (kind) => targetCapability("openai-codex", kind) !== "unsupported",
  plan(receipt, context = {}) {
    return {
      target: "openai-codex",
      coordinate: receipt.coordinate,
      operations: operation(receipt, context)
    } satisfies TargetInstallPlan;
  }
};
