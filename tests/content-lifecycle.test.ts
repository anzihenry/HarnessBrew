import assert from "node:assert/strict";
import test from "node:test";
import { applicationFixture } from "./helpers/application.js";
import { StateStore } from "../src/storage/state-store.js";
import { contentReferences } from "../src/domain/content.js";
import { parseHomeState } from "../src/domain/home-state.js";

test("content inventory preserves previous digests across repeated upgrades", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  await f.service.execute({ kind: "asset.install", coordinate: "a" });
  for (const version of [2, 3]) {
    await f.add("a", {}, `version ${version}`);
    await f.service.execute({ kind: "tap.update" }); await f.service.execute({ kind: "asset.upgrade", coordinate: "a" });
  }
  const state = await new StateStore(f.home).read();
  assert.equal(state.contents.length, 3);
  assert.deepEqual(state.contents.map(c => contentReferences(state.install.assets, c.digest).length).sort(), [0, 0, 1]);
  const bad = structuredClone(state); bad.contents = [];
  assert.throws(() => parseHomeState(bad), { code: "INVALID_STATE" });
});

test("identical asset content shares one inventory and derives active references", async t => {
  const f = await applicationFixture(t);
  for (const name of ["a", "b"]) await f.add(name, { kind: "instruction", description: "same" }, "same content");
  await f.register();
  for (const coordinate of ["a", "b"]) await f.service.execute({ kind: "asset.install", coordinate });
  let state = await new StateStore(f.home).read();
  assert.equal(state.contents.length, 1); assert.equal(state.contents[0]!.origins.length, 2);
  assert.equal(contentReferences(state.install.assets, state.contents[0]!.digest).length, 2);
  await f.service.execute({ kind: "asset.remove", coordinate: "a" });
  state = await new StateStore(f.home).read();
  assert.deepEqual(contentReferences(state.install.assets, state.contents[0]!.digest), ["test/assets/b"]);
});
