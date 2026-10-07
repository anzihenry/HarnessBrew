import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { parsePrepared } from "../src/application/plan-store.js";
import { hash, stableId } from "../src/domain/identity.js";
import { JournalStore } from "../src/transactions/journal.js";
import { StateStore } from "../src/storage/state-store.js";
import { upgradeFixture } from "./helpers/adapter-upgrade.js";

test("A saved-plan v2 remains readable while legacy v1 and disguised upgrade payloads are rejected", async () => {
  const fixture = JSON.parse(await readFile("tests/fixtures/compatibility/a-saved-plan-v2.json", "utf8"));
  assert.deepEqual(parsePrepared(fixture), fixture);
  assert.throws(() => parsePrepared({ ...fixture, version: 1 }), { code: "PLAN_STALE" });
  assert.throws(() => parsePrepared({ ...fixture, version: 3 }), { code: "INVALID_PLAN" });
  assert.throws(() => parsePrepared({ ...fixture, request: { kind: "adapter.upgrade", name: "test-adapter", module: "/plugin", authorizedSignature: hash("plugin"), capabilities: [] } }), { code: "INVALID_PLAN" });
});

test("upgrade v3 roundtrips and an unfinished v1 journal must recover before preview", async t => {
  const f = await upgradeFixture(t), before = await new StateStore(f.home).read();
  const request = await f.request();
  const store = new JournalStore(f.home);
  await store.save({ format: "harnessbrew.journal", version: 1, id: "legacy-journal", home: f.home, status: "prepared", beforeState: before, nextRevision: "legacy-next", steps: [] });
  await assert.rejects(f.service.plan(request), { code: "RECOVERY_REQUIRED" });
  assert.equal((await store.load())!.version, 1);
  await f.service.recover(); assert.deepEqual(await new StateStore(f.home).read(), before);
  const preview = await f.service.plan(request);
  const document = JSON.parse(await readFile(path.join(f.root, `.harnessbrew-cache-${stableId(f.home)}`, "plans", `${preview.planId}.json`), "utf8"));
  assert.equal(document.saved.version, 3); assert.deepEqual(parsePrepared(document.saved), document.saved);
  assert.throws(() => parsePrepared({ ...document.saved, version: 2 }), { code: "INVALID_PLAN" });
  await f.service.apply(preview.planId);
  const after = await new StateStore(f.home).read();
  assert.equal(after.version, 1); assert.equal(after.adapters.version, 1); assert.equal(after.install.version, 1);
});
