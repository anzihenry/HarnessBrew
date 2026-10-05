import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { readFile, rm, writeFile } from "node:fs/promises";
import { applicationFixture } from "./helpers/application.js";
import { StateStore } from "../src/storage/state-store.js";
import { prepareRestore } from "../src/application/restore.js";
import { inspectContent } from "../src/sources/inventory.js";

test("restore preparation fetches exact installed commit after cache loss even when remote advances", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register(); await f.service.execute({ kind: "asset.install", coordinate: "a" });
  const state = await new StateStore(f.home).read();
  const original = await readFile(path.join(f.home, "content", state.contents[0]!.digest.slice(7), "SKILL.md"), "utf8");
  await f.add("a", {}, "new remote version");
  await rm(state.sources.snapshots[0]!.contentLocation, { recursive: true });
  const prepared = await prepareRestore(state, "a", path.join(f.root, "recovery-cache"));
  assert.equal((await inspectContent(prepared.staged)).digest, state.contents[0]!.digest);
  assert.equal(await readFile(path.join(prepared.staged, "SKILL.md"), "utf8"), original);
  assert.deepEqual(await new StateStore(f.home).read(), state);
});

test("restore preparation refuses revoked trust and cannot substitute unavailable exact sources", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register(); await f.service.execute({ kind: "asset.install", coordinate: "a" });
  const state = await new StateStore(f.home).read(), cache = path.join(f.root, "recovery-cache");
  const revoked = structuredClone(state); revoked.sources.registrations[0]!.trusted = false;
  await assert.rejects(prepareRestore(revoked, "a", cache), { code: "SOURCE_UNTRUSTED" });
  await writeFile(path.join(state.sources.snapshots[0]!.contentLocation, "tap.json"), "damaged");
  await rm(f.repository, { recursive: true });
  await assert.rejects(prepareRestore(state, "a", cache), { code: "GIT_FAILED" });
  assert.deepEqual(await new StateStore(f.home).read(), state);
});
