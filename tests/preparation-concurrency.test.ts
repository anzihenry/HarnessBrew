import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { applicationFixture } from "./helpers/application.js";
import { createApplication } from "../src/application/service.js";
import { nodeApplicationDependencies } from "../src/application/dependencies.js";
import { stableId } from "../src/domain/identity.js";
import { exists } from "../src/execution/files.js";

function gate() {
  let release!: () => void, enter!: () => void;
  const ready = new Promise<void>(resolve => { enter = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  return { ready, release, enter, wait };
}

test("slow source preparation holds no Home or external write lock", { timeout: 20000 }, async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  const before = await f.service.query({ kind: "list" }), g = gate(); t.after(g.release);
  const slow = createApplication(f.options, { sources: root => {
    const source = nodeApplicationDependencies.sources(root);
    return { prepare: source.prepare.bind(source), async prepareSelection(request) { g.enter(); await g.wait; return source.prepareSelection(request); } };
  } });
  t.after(() => slow.close());
  const pending = slow.execute({ kind: "tap.update" }); void pending.catch(() => undefined);
  try {
    await g.ready;
    assert.equal((await f.service.query({ kind: "list" })).revision, before.revision);
    const other = createApplication({ ...f.options, home: path.join(f.root, "other") });
    try { await other.execute({ kind: "tap.add", name: "test/assets", url: f.repository }); }
    finally { await other.close(); }
    assert.equal((await f.service.query({ kind: "list" })).revision, before.revision);
  } finally { g.release(); }
  await pending;
});

test("preview stages verified content in cache; transaction consumes it after journaling", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  const preview = await f.service.plan({ kind: "asset.install", coordinate: "a", placements: [f.placement] });
  const cache = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`);
  const { saved } = JSON.parse(await readFile(path.join(cache, "plans", `${preview.planId}.json`), "utf8"));
  const entry = saved.preparedContent[0]; assert.ok(entry);
  const destination = path.join(f.home, "content", entry.digest.slice(7));
  assert.equal(await exists(entry.staged), true); assert.equal(await exists(destination), false);
  let observed = false;
  const service = createApplication(f.options, { transactionFault: async point => {
    if (point === "prepared") { observed = true; assert.equal(await exists(entry.staged), true); assert.equal(await exists(destination), false); }
  } });
  try { await service.apply(preview.planId); } finally { await service.close(); }
  assert.equal(observed, true); assert.equal(await exists(entry.staged), false); assert.equal(await exists(destination), true);
  assert.equal((await f.service.doctor()).healthy, true);
});
