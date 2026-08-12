import assert from "node:assert/strict";
import { lstat, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { bundleInstall } from "../src/core/bundle.js";
import { installForTarget, unlinkFormula } from "../src/core/targets.js";
import {
  hasTargetAdapter,
  listTargetAdapters,
  registerTargetAdapter,
  targetAdapterVersion
} from "../src/core/targets/registry.js";
import { planTargetInstall } from "../src/core/targets/planner.js";
import type { TargetAdapter } from "../src/core/targets/types.js";
import { addTap } from "../src/core/taps.js";
import { addFormula, createTapRepository } from "./helpers/git.js";

const symlinkCapabilities: TargetAdapter["capabilities"] = {
  skill: "symlink-directory",
  agent: "symlink-file",
  workflow: "symlink-file",
  instruction: "symlink-file",
  prompt: "symlink-file",
  mcp: "unsupported",
  adapter: "unsupported"
};

function testAdapter(name: string, root: string): TargetAdapter {
  return {
    apiVersion: 1,
    name,
    version: "1.0.0",
    capabilities: symlinkCapabilities,
    plan(receipt, context = {}) {
      const formulaName = receipt.coordinate.split("/").at(-1) as string;
      const strategy = this.capabilities[receipt.kind as keyof typeof this.capabilities];
      if (strategy === "unsupported") return { target: name, coordinate: receipt.coordinate, operations: [] };
      return {
        target: name,
        coordinate: receipt.coordinate,
        operations: [{
          strategy,
          source: receipt.kind === "skill" ? receipt.cellarPath : path.join(receipt.cellarPath, receipt.entry),
          destination: path.join(context.root ?? root, formulaName)
        }]
      };
    }
  };
}

test("third-party Target Adapters install through the managed transaction layer", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-adapter-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, "cursor", "skills");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "review", { targets: ["cursor-test"] });
  await addTap(home, "personal/agents", repository, { trust: true });
  const unregister = registerTargetAdapter(testAdapter("cursor-test", targetRoot));
  try {
    assert.equal(hasTargetAdapter("cursor-test"), true);
    assert.ok(listTargetAdapters().some((adapter) => adapter.name === "cursor-test"));
    assert.match(targetAdapterVersion(), /cursor-test@1\.0\.0/u);
    const [receipt] = await installForTarget(home, "review", "cursor-test");
    assert.equal(receipt?.operations[0]?.target, "cursor-test");
    const destination = path.join(targetRoot, "review");
    assert.equal((await lstat(destination)).isSymbolicLink(), true);
    await unlinkFormula(home, "review", "cursor-test");
    await assert.rejects(lstat(destination), /ENOENT/u);
  } finally {
    unregister();
  }
  assert.equal(hasTargetAdapter("cursor-test"), false);
});

test("Harnessfile locks the registered third-party Adapter version", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-adapter-bundle-"));
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "review", { targets: ["bundle-target"] });
  const harnessfile = path.join(root, "Harnessfile");
  await writeFile(harnessfile, `schemaVersion: 2
taps:
  - name: personal/agents
    git: ${JSON.stringify(repository)}
    trust: true
assets:
  - formula: personal/agents/review
    targets:
      - target: bundle-target
        scope: user
        root: ./custom-target
`);
  const unregister = registerTargetAdapter(testAdapter("bundle-target", path.join(root, "fallback")));
  try {
    const lock = await bundleInstall(path.join(root, "home"), harnessfile);
    assert.equal(lock.schemaVersion, 2);
    if (lock.schemaVersion !== 2) throw new Error("expected Harnessfile v2 lock");
    assert.match(lock.adapterVersion, /bundle-target@1\.0\.0/u);
    assert.equal((await lstat(path.join(root, "custom-target", "review"))).isSymbolicLink(), true);
  } finally {
    unregister();
  }
});

test("Adapter registration and plans reject incompatible or unsafe contracts", () => {
  const root = path.resolve("/tmp/harnessbrew-adapter-contract");
  const adapter = testAdapter("contract-test", root);
  const unregister = registerTargetAdapter(adapter);
  try {
    assert.throws(() => registerTargetAdapter(adapter), /already registered/u);
    const receipt = {
      schemaVersion: 2 as const,
      coordinate: "personal/agents/review",
      kind: "skill",
      description: "review",
      tap: "personal/agents",
      commit: "a".repeat(40),
      cellarPath: "/cellar/review",
      entry: "SKILL.md",
      dependencies: [],
      conflicts: [],
      requested: true,
      files: [],
      supportedTargets: ["contract-test"],
      targets: [],
      links: [],
      operations: [],
      installedAt: "2026-08-13T00:00:00.000Z"
    };
    assert.equal(planTargetInstall(receipt, "contract-test").target, "contract-test");

    const unsafe: TargetAdapter = { ...testAdapter("unsafe-test", root), plan: (candidate) => ({
      target: "unsafe-test",
      coordinate: candidate.coordinate,
      operations: [{
        strategy: "symlink-directory",
        source: "/outside/cellar",
        destination: path.join(root, "unsafe")
      }]
    }) };
    const unregisterUnsafe = registerTargetAdapter(unsafe);
    try {
      assert.throws(() => planTargetInstall(receipt, "unsafe-test"), /source escapes the Cellar/u);
    } finally {
      unregisterUnsafe();
    }
  } finally {
    unregister();
  }

  assert.throws(() => registerTargetAdapter({ ...adapter, name: "Invalid Name" }), /Invalid Target Adapter name/u);
  assert.throws(
    () => registerTargetAdapter({ ...adapter, name: "future-test", apiVersion: 2 as 1 }),
    /Unsupported Target Adapter API version/u
  );
  assert.throws(
    () => registerTargetAdapter({
      ...adapter,
      name: "renderer-test",
      capabilities: { ...adapter.capabilities, agent: "render-file" }
    }),
    /only supports symlink capabilities/u
  );
});
