import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { CacheLeases } from "../src/application/cache-leases.js";
import { applicationFixture } from "./helpers/application.js";
import { stableId } from "../src/domain/identity.js";

test("a live cross-process lease excludes maintenance; SIGKILL releases only dead protection", { timeout: 10000 }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), "hb-lease-")); t.after(() => rm(root, { recursive: true, force: true }));
  const child = fork(new URL("./helpers/cache-lease-child.js", import.meta.url), [root], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  t.after(() => { child.kill("SIGKILL"); });
  const exited = once(child, "exit");
  await once(child.stdout!, "data");
  const leases = new CacheLeases(root);
  assert.deepEqual(await leases.tryMaintenance(async () => { throw new Error("must not run"); }), { ran: false });
  child.kill("SIGKILL"); await exited;
  assert.deepEqual(await leases.tryMaintenance(async refs => refs), { ran: true, value: [] });
  assert.deepEqual(await readdir(path.join(root, "leases")), []);
});

test("concurrent leases coexist and persistent references survive all producers", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "hb-lease-")); t.after(() => rm(root, { recursive: true, force: true }));
  const leases = new CacheLeases(root), resource = path.join(root, "sources", "pinned");
  await leases.withLease(async () => {
    await leases.withLease(async () => {
      assert.equal((await readdir(path.join(root, "leases"))).length, 2);
      await leases.pin("11111111-1111-1111-1111-111111111111", [resource]);
    });
    assert.deepEqual(await leases.tryMaintenance(async () => undefined), { ran: false });
  });
  assert.deepEqual(await leases.tryMaintenance(async refs => refs), { ran: true, value: [resource] });
  await assert.rejects(leases.withLease(async () => { throw new Error("producer failed"); }), /producer failed/);
  assert.equal((await readdir(path.join(root, "leases"))).length, 0);
  await writeFile(path.join(root, "leases", "interrupted.tmp"), "partial");
  await assert.rejects(leases.tryMaintenance(async () => undefined), { code: "LOCK_CORRUPT" });
});

test("published preview pins its inputs before its active lease ends", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  const preview = await f.service.plan({ kind: "asset.install", coordinate: "a" });
  const cache = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`);
  const result = await new CacheLeases(cache).tryMaintenance(async refs => refs);
  assert.equal(result.ran, true);
  if (result.ran) { assert.ok(result.value.some(p => p.endsWith(`${preview.planId}.json`))); assert.ok(result.value.some(p => p.includes("sources"))); }
  assert.deepEqual(await readdir(path.join(cache, "leases")), []);
});
