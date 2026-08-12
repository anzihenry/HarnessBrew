import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { doctor } from "../src/core/doctor.js";
import { installFormula, readReceipt, type InstalledOperationType } from "../src/core/installations.js";
import { addTap } from "../src/core/taps.js";
import {
  linkFormula,
  unlinkFormula,
  type BuiltinTarget,
  type LinkOptions,
  type TargetScope
} from "../src/core/targets.js";
import { verifyTargetOperation } from "../src/core/targets/transaction.js";
import { addFormula, createTapRepository, git } from "./helpers/git.js";

const deliverableKinds = ["skill", "agent", "workflow", "instruction", "prompt", "mcp"] as const;
type DeliverableKind = (typeof deliverableKinds)[number];

const kindDirectories: Record<DeliverableKind, string> = {
  skill: "skills",
  agent: "agents",
  workflow: "workflows",
  instruction: "instructions",
  prompt: "prompts",
  mcp: "mcp"
};

const operationTypes: Record<DeliverableKind, Record<BuiltinTarget, InstalledOperationType>> = {
  skill: { "openai-codex": "symlink-directory", "claude-code": "symlink-directory" },
  agent: { "openai-codex": "render-file", "claude-code": "render-file" },
  workflow: { "openai-codex": "render-file", "claude-code": "render-file" },
  instruction: { "openai-codex": "managed-block", "claude-code": "symlink-file" },
  prompt: { "openai-codex": "render-file", "claude-code": "render-file" },
  mcp: { "openai-codex": "merge-config", "claude-code": "merge-config" }
};

function expectedDestination(
  kind: DeliverableKind,
  name: string,
  target: BuiltinTarget,
  scope: TargetScope,
  userRoot: string,
  projectRoot: string
): string {
  const root = scope === "user"
    ? userRoot
    : target === "openai-codex"
      ? path.join(projectRoot, ".codex")
      : path.join(projectRoot, ".claude");
  if (target === "openai-codex") {
    switch (kind) {
      case "skill": return path.join(scope === "project" ? projectRoot : root, scope === "project" ? ".agents/skills" : "skills", name);
      case "workflow":
      case "prompt": return path.join(scope === "project" ? projectRoot : root, scope === "project" ? ".agents/skills" : "skills", name, "SKILL.md");
      case "agent": return path.join(root, "agents", `${name}.toml`);
      case "instruction": return scope === "project" ? path.join(projectRoot, "AGENTS.md") : path.join(root, "AGENTS.md");
      case "mcp": return path.join(root, "config.toml");
    }
  }
  switch (kind) {
    case "skill": return path.join(root, "skills", name);
    case "workflow":
    case "prompt": return path.join(root, "skills", name, "SKILL.md");
    case "agent": return path.join(root, "agents", `${name}.md`);
    case "instruction": return path.join(root, "rules", `${name}.md`);
    case "mcp": return scope === "project" ? path.join(projectRoot, ".mcp.json") : path.join(root, ".mcp.json");
  }
}

test("formula x target x scope matrix installs, verifies, and unlinks every supported placement", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-matrix-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);
  for (const kind of deliverableKinds) {
    const name = `${kind}-matrix`;
    await addFormula(repository, kindDirectories[kind], name, {
      targets: ["openai-codex", "claude-code"]
    });
    if (kind === "mcp") {
      await writeFile(path.join(repository, "mcp", name, "content.md"), JSON.stringify({
        command: "matrix-server",
        args: ["serve"],
        envVars: ["MATRIX_TOKEN"]
      }));
      await git(repository, "add", `mcp/${name}/content.md`);
      await git(repository, "commit", "-m", "define matrix mcp");
    }
  }
  await addFormula(repository, "adapters", "adapter-matrix", {
    targets: ["openai-codex", "claude-code"]
  });
  await addTap(home, "personal/agents", repository, { trust: true });

  const targets: BuiltinTarget[] = ["openai-codex", "claude-code"];
  const scopes: TargetScope[] = ["user", "project"];
  const projectRoot = path.join(root, "project");
  for (const kind of deliverableKinds) {
    const name = `${kind}-matrix`;
    await installFormula(home, name);
    for (const target of targets) {
      const userRoot = path.join(root, `user-${target}`);
      for (const scope of scopes) {
        const options: LinkOptions = scope === "user"
          ? { scope, root: userRoot }
          : { scope, projectRoot };
        const receipt = await linkFormula(home, name, target, options);
        const destination = expectedDestination(kind, name, target, scope, userRoot, projectRoot);
        const operation = receipt.operations.find((candidate) => candidate.target === target
          && candidate.scope === scope
          && candidate.destination === destination);
        assert.ok(operation, `${kind}/${target}/${scope} should record ${destination}`);
        assert.equal(operation.type, operationTypes[kind][target]);
        await verifyTargetOperation(operation);
        if (kind === "workflow" || kind === "prompt") {
          assert.match(await readFile(destination, "utf8"), new RegExp(`kind: ${kind}`, "u"));
        }
      }
    }
    const receipt = await readReceipt(home, `personal/agents/${name}`);
    assert.equal(receipt?.operations.length, 4);
    assert.deepEqual(receipt?.targets.sort(), ["claude-code", "openai-codex"]);
  }

  await installFormula(home, "adapter-matrix");
  for (const target of targets) {
    await assert.rejects(linkFormula(home, "adapter-matrix", target, {
      scope: "project",
      projectRoot
    }), /cannot be linked/u);
  }
  assert.equal((await doctor(home)).healthy, true);

  for (const kind of deliverableKinds) {
    const name = `${kind}-matrix`;
    for (const target of targets) {
      const userRoot = path.join(root, `user-${target}`);
      await unlinkFormula(home, name, target, { scope: "user", root: userRoot });
      await unlinkFormula(home, name, target, { scope: "project", projectRoot });
    }
    assert.equal((await readReceipt(home, `personal/agents/${name}`))?.operations.length, 0);
  }
});
