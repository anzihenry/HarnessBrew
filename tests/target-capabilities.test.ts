import assert from "node:assert/strict";
import test from "node:test";
import { formulaKinds } from "../src/core/formulas.js";
import {
  builtinTargets,
  targetCapabilities,
  targetCapability,
  targetOperationKinds
} from "../src/core/target-capabilities.js";

test("target capability matrix explicitly covers every formula kind", () => {
  for (const target of builtinTargets) {
    assert.deepEqual(Object.keys(targetCapabilities[target]).sort(), [...formulaKinds].sort());
    for (const kind of formulaKinds) {
      assert.ok(targetOperationKinds.includes(targetCapability(target, kind)));
    }
  }
});

test("target capability matrix captures platform-specific installation strategies", () => {
  assert.equal(targetCapability("openai-codex", "skill"), "symlink-directory");
  assert.equal(targetCapability("openai-codex", "instruction"), "managed-block");
  assert.equal(targetCapability("claude-code", "instruction"), "symlink-file");
  assert.equal(targetCapability("openai-codex", "mcp"), "merge-config");
  assert.equal(targetCapability("claude-code", "adapter"), "unsupported");
});
