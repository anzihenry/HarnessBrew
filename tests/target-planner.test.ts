import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { planTargetInstall } from "../src/core/targets/planner.js";
import type { InstallReceipt } from "../src/core/installations.js";

function receipt(kind: string, entry = "content.md"): InstallReceipt {
  return {
    schemaVersion: 2,
    coordinate: `personal/agents/example`,
    kind,
    description: "Example formula",
    tap: "personal/agents",
    commit: "a".repeat(40),
    cellarPath: "/cellar/personal/agents/example/commit",
    entry,
    dependencies: [],
    conflicts: [],
    requested: true,
    files: [],
    supportedTargets: ["openai-codex", "claude-code"],
    targets: [],
    links: [],
    operations: [],
    installedAt: "2026-08-12T00:00:00.000Z"
  };
}

test("Codex planner produces native destinations without touching the filesystem", () => {
  assert.deepEqual(planTargetInstall(receipt("skill", "SKILL.md"), "openai-codex", { root: "/target/codex" }).operations, [{
    strategy: "symlink-directory",
    source: "/cellar/personal/agents/example/commit",
    destination: path.resolve("/target/codex/skills/example")
  }]);
  assert.equal(
    planTargetInstall(receipt("agent"), "openai-codex", { root: "/target/codex" }).operations[0]?.destination,
    path.resolve("/target/codex/agents/example.toml")
  );
  assert.equal(
    planTargetInstall(receipt("instruction"), "openai-codex", { root: "/target/codex" }).operations[0]?.destination,
    path.resolve("/target/codex/AGENTS.md")
  );
});

test("Claude Code planner maps assets to native destinations", () => {
  assert.equal(
    planTargetInstall(receipt("skill", "SKILL.md"), "claude-code", { root: "/target/claude" }).operations[0]?.destination,
    path.resolve("/target/claude/skills/example")
  );
  assert.equal(
    planTargetInstall(receipt("agent"), "claude-code", { root: "/target/claude" }).operations[0]?.destination,
    path.resolve("/target/claude/agents/example.md")
  );
  assert.equal(
    planTargetInstall(receipt("mcp"), "claude-code", { root: "/project" }).operations[0]?.destination,
    path.resolve("/project/.mcp.json")
  );
});

test("planner rejects unsupported and unknown formula kinds", () => {
  assert.throws(() => planTargetInstall(receipt("adapter"), "openai-codex"), /unsupported/);
  assert.throws(() => planTargetInstall(receipt("unknown"), "claude-code"), /Unsupported formula kind/);
});

test("planners distinguish user and project scope roots", () => {
  const projectRoot = path.resolve("/workspace/project");
  assert.equal(
    planTargetInstall(receipt("skill", "SKILL.md"), "openai-codex", {
      scope: "project",
      projectRoot
    }).operations[0]?.destination,
    path.join(projectRoot, ".agents", "skills", "example")
  );
  assert.equal(
    planTargetInstall(receipt("instruction"), "openai-codex", {
      scope: "project",
      projectRoot
    }).operations[0]?.destination,
    path.join(projectRoot, "AGENTS.md")
  );
  assert.equal(
    planTargetInstall(receipt("mcp"), "claude-code", {
      scope: "project",
      projectRoot
    }).operations[0]?.destination,
    path.join(projectRoot, ".mcp.json")
  );
});
