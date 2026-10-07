import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { upgradeFixture } from "./helpers/adapter-upgrade.js";
import { StateStore } from "../src/storage/state-store.js";
import { bundleFixture } from "./helpers/adapter-bundles.js";

test("joint preview requires every exact binding and updates only lock adapter signatures", async t => {
  const f = await bundleFixture(t), request = await f.request(), before = await new StateStore(f.home).read();
  await assert.rejects(f.service.plan({ ...request, bundleFiles: [f.files[0]!] }), (e: any) => e.code === "LOCK_MISMATCH" && e.details.missingBindings.length === 1);
  const preview = await f.service.plan({ ...request, bundleFiles: f.files });
  const updates = preview.fileUpdates.filter(u => u.path.endsWith(".lock.json")); assert.equal(updates.length, 2);
  for (const update of updates) {
    const old = JSON.parse(await readFile(update.path, "utf8")); assert.equal(update.after.kind, "file");
    const next = JSON.parse((update.after as { content: string }).content);
    assert.deepEqual({ ...next, adapterSignatures: old.adapterSignatures }, old);
    assert.equal(next.adapterSignatures[0].signature, request.authorizedSignature);
  }
  assert.deepEqual(await new StateStore(f.home).read(), before);
});

test("joint preview rejects alias duplicates, extra checkouts and declaration drift", async t => {
  const f = await bundleFixture(t), request = await f.request();
  const alias = path.join(f.root, "alias"); await symlink(path.dirname(f.files[0]!), alias);
  await assert.rejects(f.service.plan({ ...request, bundleFiles: [...f.files, path.join(alias, "Harnessfile.yaml")] }), { code: "LOCK_MISMATCH" });
  const extra = path.join(f.root, "extra"); await mkdir(extra); const file = path.join(extra, "Harnessfile.yaml"); await writeFile(file, await readFile(f.files[0]!));
  await assert.rejects(f.service.plan({ ...request, bundleFiles: [...f.files, file] }), { code: "LOCK_MISMATCH" });
  const manifest = JSON.parse(await readFile(f.files[1]!, "utf8")); manifest.assets[0].placements[0].scope = "user";
  await writeFile(f.files[1]!, JSON.stringify(manifest));
  await assert.rejects(f.service.plan({ ...request, bundleFiles: f.files }), { code: "LOCK_MISMATCH" });
});

test("joint commit migrates manual and two Bundle targets while preserving every asset pin", async t => {
  const f = await bundleFixture(t), before = await new StateStore(f.home).read();
  const request = { ...await f.request(), bundleFiles: f.files };
  const preview = await f.service.plan(request); await f.service.apply(preview.planId);
  const after = await new StateStore(f.home).read();
  assert.deepEqual(after.install.requirements, before.install.requirements);
  assert.deepEqual(after.install.assets.map(({ operations, ...a }) => a), before.install.assets.map(({ operations, ...a }) => a));
  assert.equal(after.install.operations.length, 3);
  for (const file of f.files) assert.equal(JSON.parse(await readFile(`${file}.lock.json`, "utf8")).adapterSignatures[0].signature, request.authorizedSignature);
  assert.equal(after.adapters.registrations.find(a => a.name === request.name)!.signature, request.authorizedSignature);
  assert.equal((await f.service.execute(request)).committedRevision, after.revision);
});

for (const index of [0, 1]) test(`lock ${index + 1} edited after preview rejects joint transaction`, async t => {
  const f = await bundleFixture(t), before = await new StateStore(f.home).read();
  const preview = await f.service.plan({ ...await f.request(), bundleFiles: f.files });
  const lock = `${f.files[index]}.lock.json`;
  const { appendFile } = await import("node:fs/promises"); await appendFile(lock, "\n");
  await assert.rejects(f.service.apply(preview.planId), { code: "PLAN_STALE" });
  assert.deepEqual(await new StateStore(f.home).read(), before);
});
