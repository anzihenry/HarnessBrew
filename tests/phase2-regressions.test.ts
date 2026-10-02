import assert from "node:assert/strict";
import test from "node:test";
import { applicationFixture } from "./helpers/application.js";
import { StateStore } from "../src/storage/state-store.js";

test("A02: public upgrade installs a newly introduced dependency and its placement", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  await f.service.execute({ kind: "asset.install", coordinate: "a", placements: [f.placement] });
  await f.add("b"); await f.add("a", { dependencies: ["test/assets/b"] });
  await f.service.execute({ kind: "tap.update" });
  await f.service.execute({ kind: "asset.upgrade", coordinate: "a" });
  const state = await new StateStore(f.home).read(); assert.deepEqual(state.install.assets.map(a => a.coordinate), ["test/assets/a", "test/assets/b"]);
  assert.equal(state.install.operations.length, 2); assert.equal((await f.service.doctor()).healthy, true);
});
test("A03: public upgrade conflict preserves installed versions and targets", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.add("c"); await f.register();
  for (const coordinate of ["a", "c"]) await f.service.execute({ kind: "asset.install", coordinate, placements: [f.placement] });
  await f.add("a", { conflicts: ["test/assets/c"] }); await f.service.execute({ kind: "tap.update" });
  const before = await new StateStore(f.home).read();
  await assert.rejects(f.service.execute({ kind: "asset.upgrade", coordinate: "a" }), { code: "ASSET_CONFLICT" });
  assert.deepEqual(await new StateStore(f.home).read(), before); assert.equal((await f.service.doctor()).healthy, true);
});
test("A05: rejected public install preserves an already linked dependency", async t => {
  const f = await applicationFixture(t); await f.add("b"); await f.add("a", { dependencies: ["test/assets/b"], targets: ["unsupported"] }); await f.register();
  await f.service.execute({ kind: "asset.install", coordinate: "b", placements: [f.placement] });
  const before = await new StateStore(f.home).read();
  await assert.rejects(f.service.execute({ kind: "asset.install", coordinate: "a", placements: [f.placement] }), { code: "TARGET_UNSUPPORTED" });
  assert.deepEqual(await new StateStore(f.home).read(), before); assert.equal((await f.service.doctor()).healthy, true);
});
