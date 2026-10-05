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

test("cleanup reclaims upgrade history, forgets missing content and preserves unknown/modified directories", async t => {
  const { mkdir, writeFile, rm, access } = await import("node:fs/promises");
  const path = await import("node:path");
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  await f.service.execute({ kind: "asset.install", coordinate: "a" });
  const old = (await new StateStore(f.home).read()).contents[0]!;
  await f.add("a", {}, "new"); await f.service.execute({ kind: "tap.update" }); await f.service.execute({ kind: "asset.upgrade", coordinate: "a" });
  const preview = await f.service.plan({ kind: "cleanup" });
  assert.deepEqual(preview.contentChanges.map(c => c.digest), [old.digest]); assert.ok(preview.contentChanges[0]!.bytes > 0);
  await f.service.apply(preview.planId);
  await assert.rejects(access(path.join(f.home, "content", old.digest.slice(7))));
  await f.service.execute({ kind: "asset.remove", coordinate: "a" });
  const current = (await new StateStore(f.home).read()).contents[0]!;
  const destination = path.join(f.home, "content", current.digest.slice(7));
  const stale = await f.service.plan({ kind: "cleanup" });
  await writeFile(path.join(destination, "user.txt"), "keep");
  await assert.rejects(f.service.apply(stale.planId), { code: "PLAN_STALE" });
  assert.ok((await f.service.execute({ kind: "cleanup" })).diagnostics.length);
  await access(path.join(destination, "user.txt"));
  await mkdir(path.join(f.home, "content", "unknown"));
  await rm(destination, { recursive: true });
  const result = await f.service.execute({ kind: "cleanup" });
  assert.equal(result.contentChanges![0]!.action, "forget-missing"); assert.ok(result.diagnostics.some(d => d.includes("Unregistered")));
  assert.equal((await new StateStore(f.home).read()).contents.length, 0);
  await access(path.join(f.home, "content", "unknown"));
});
