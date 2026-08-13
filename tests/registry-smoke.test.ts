import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const module = await import(pathToFileURL(path.resolve("scripts/registry-smoke.mjs")).href) as {
  assertRegistryVersion(version: string): string;
};

test("registry smoke accepts only exact npm versions", () => {
  assert.equal(module.assertRegistryVersion("0.7.0"), "0.7.0");
  assert.equal(module.assertRegistryVersion("0.7.0-rc.1"), "0.7.0-rc.1");
  assert.throws(() => module.assertRegistryVersion("latest"), /exact npm version/u);
  assert.throws(() => module.assertRegistryVersion("^0.7.0"), /exact npm version/u);
});
