import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { applicationFixture } from "./helpers/application.js";
import { createApplication } from "../src/application/service.js";
import { exists } from "../src/execution/files.js";
import { stableId } from "../src/domain/identity.js";
import { CacheLeases } from "../src/application/cache-leases.js";
import { StateStore } from "../src/storage/state-store.js";

for (const point of ["after-prepare", "prepared", "after-record", "after-write", "after-state", "committed"] as const) test(`Application SIGKILL at ${point} preserves transaction semantics`, { timeout: 20000 }, async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  const before = await new StateStore(f.home).read();
  const child = fork(new URL("./helpers/preparation-child.js", import.meta.url), [f.home, f.project, f.userHome, point], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  t.after(() => { child.kill("SIGKILL"); });
  const exited = once(child, "exit");
  const ready = await Promise.race([once(child, "message"), exited.then(() => { throw new Error("Child exited before checkpoint"); })]);
  assert.equal(ready[0], "ready");
  const cache = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`);
  assert.deepEqual(await new CacheLeases(cache).tryMaintenance(async () => undefined), { ran: false });
  child.kill("SIGKILL"); await exited;
  if (point === "after-write") {
    await assert.rejects(f.service.recover(), { code: "RECOVERY_REQUIRED" });
    assert.equal(await exists(path.join(f.home, "transaction.json")), true);
    return;
  }
  if (point === "after-prepare") {
    assert.equal(await exists(path.join(f.home, "transaction.json")), false);
    assert.deepEqual(await new StateStore(f.home).read(), before);
    assert.equal((await new CacheLeases(cache).tryMaintenance(async () => undefined)).ran, true);
  } else {
    await f.service.recover();
    const after = await new StateStore(f.home).read();
    if (point === "committed") assert.equal(after.install.assets.length, 1);
    else assert.deepEqual(after, before);
  }
  assert.equal((await f.service.doctor()).healthy, true);
});

function barrier(count: number) {
  let n = 0, release!: () => void, all!: () => void;
  const ready = new Promise<void>(r => { all = r; }), wait = new Promise<void>(r => { release = r; });
  return { ready, release, async checkpoint() { if (++n === count) all(); await wait; } };
}

test("two services preparing against one initial revision produce one commit and one explicit stale result", { timeout: 20000 }, async t => {
  const f = await applicationFixture(t), g = barrier(2); await f.add("a"); t.after(g.release);
  const one = createApplication(f.options, { preparationCheckpoint: g.checkpoint }), two = createApplication(f.options, { preparationCheckpoint: g.checkpoint });
  t.after(() => Promise.all([one.close(), two.close()]));
  const result = Promise.allSettled([one.execute({ kind: "tap.add", name: "one/assets", url: f.repository }), two.execute({ kind: "tap.add", name: "two/assets", url: f.repository })]);
  await g.ready; g.release();
  const values = await result;
  assert.equal(values.filter(v => v.status === "fulfilled").length, 1);
  assert.equal((values.find(v => v.status === "rejected") as PromiseRejectedResult).reason.code, "PLAN_STALE");
  assert.equal((await f.service.query({ kind: "taps" })).length, 1);
});

test("two Homes preparing shared config require explicit replan and preserve both keys", { timeout: 20000 }, async t => {
  const f = await applicationFixture(t); await f.add("a", { kind: "mcp" }); await f.add("b", { kind: "mcp" }); await f.register();
  const options = { ...f.options, home: path.join(f.root, "second") };
  const setup = createApplication(options); t.after(() => setup.close());
  await setup.execute({ kind: "tap.add", name: "test/assets", url: f.repository }); await setup.execute({ kind: "tap.trust", name: "test/assets" });
  const g = barrier(2); t.after(g.release);
  const one = createApplication(f.options, { preparationCheckpoint: g.checkpoint }), two = createApplication(options, { preparationCheckpoint: g.checkpoint });
  t.after(() => Promise.all([one.close(), two.close()]));
  const requests = ["a", "b"].map(coordinate => ({ kind: "asset.install" as const, coordinate, placements: [f.placement] }));
  const result = Promise.allSettled([one.execute(requests[0]!), two.execute(requests[1]!)]);
  await g.ready; g.release(); const values = await result;
  assert.equal(values.filter(v => v.status === "fulfilled").length, 1);
  const loser = values.findIndex(v => v.status === "rejected");
  assert.equal((values[loser] as PromiseRejectedResult).reason.code, "PLAN_STALE");
  await (loser === 0 ? f.service : setup).execute(requests[loser]!);
  const config = await readFile(path.join(f.project, ".codex", "config.toml"), "utf8");
  assert.match(config, /"a"/); assert.match(config, /"b"/);
});

test("loaded plugin cache drift after preparation cannot commit its already imported implementation", async t => {
  const f = await applicationFixture(t), plugin = path.join(f.root, "plugin"); await mkdir(plugin);
  await writeFile(path.join(plugin, "package.json"), JSON.stringify({ type: "module", harnessbrew: { format: "harnessbrew.adapter-package", version: 1, name: "test-adapter", adapterVersion: "1", entry: "index.mjs" } }));
  await writeFile(path.join(plugin, "index.mjs"), `import path from 'node:path'; export default { protocol:'harnessbrew.adapter/1', name:'test-adapter', version:'1', supportedKinds:['skill'], requiredCapabilities:['link-directory'], async plan(asset,p) { return { operations:[{type:'link-directory',sourceRelativePath:'.',resource:{kind:'path',path:path.join(p.roots.skills,'a'),pathType:'directory'}}] }; } };`);
  await f.add("a", { targets: ["test-adapter"] }); await f.register();
  await f.service.execute({ kind: "adapter.add", module: plugin, capabilities: ["link-directory"] });
  const registration = (await f.service.query({ kind: "adapters" })).find(a => a.name === "test-adapter")!;
  const cache = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`);
  const service = createApplication(f.options, { preparationCheckpoint: async () => { await writeFile(path.join(cache, "plugins", registration.signature.slice(7), "extra"), "drift"); } });
  try { await assert.rejects(service.execute({ kind: "asset.install", coordinate: "a", placements: [{ ...f.placement, target: "test-adapter" }] }), { code: "ADAPTER_CHANGED" }); }
  finally { await service.close(); }
  assert.equal((await f.service.query({ kind: "list" })).assets.length, 0);
  assert.equal(await exists(path.join(f.home, "transaction.json")), false);
});


test("historical source caches retain live leases and durable preview references", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  const cache = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`), oldCache = path.join(f.root, ".harnessbrew-cache-aaaa");
  await cp(cache, oldCache, { recursive: true });
  const store = new StateStore(f.home), state = await store.read();
  for (const snapshot of state.sources.snapshots) snapshot.contentLocation = snapshot.contentLocation.replace(cache, oldCache);
  await store.commit(state.revision, state);
  const service = createApplication(f.options, { preparationCheckpoint: async () => {
    assert.deepEqual(await new CacheLeases(oldCache).tryMaintenance(async () => undefined), { ran: false });
  } });
  try {
    const preview = await service.plan({ kind: "asset.install", coordinate: "a" });
    const refs = await new CacheLeases(oldCache).tryMaintenance(async resources => resources);
    assert.equal(refs.ran, true);
    if (refs.ran) assert.ok(refs.value.some(p => p.endsWith(`${preview.planId}.json`)));
    await service.apply(preview.planId);
  } finally { await service.close(); }
});

test("prepared bytes modified after planning are rejected before Journal publication", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  const cache = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`);
  const service = createApplication(f.options, { preparationCheckpoint: async () => {
    const [id] = await readdir(path.join(cache, "prepared"));
    const digest = (await readdir(path.join(cache, "prepared", id!))).find(name => /^[a-f0-9]{64}$/u.test(name));
    assert.ok(digest, "prepared content directory exists alongside its ownership receipt");
    await writeFile(path.join(cache, "prepared", id!, digest!, "SKILL.md"), "external change");
  } });
  try { await assert.rejects(service.execute({ kind: "asset.install", coordinate: "a" }), { code: "CONTENT_MODIFIED" }); }
  finally { await service.close(); }
  assert.equal(await exists(path.join(f.home, "transaction.json")), false);
  assert.equal((await f.service.query({ kind: "list" })).assets.length, 0);
});
