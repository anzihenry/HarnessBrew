import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { upgradeFixture } from "./helpers/adapter-upgrade.js";
import { StateStore } from "../src/storage/state-store.js";
export async function bundleFixture(t: Parameters<typeof upgradeFixture>[0]) {
  const f = await upgradeFixture(t), files: string[] = [];
  for (const name of ["one", "two"]) {
    const dir = path.join(f.root, name); await mkdir(dir);
    const file = path.join(dir, "Harnessfile.yaml");
    await writeFile(file, JSON.stringify({ format: "harnessbrew.manifest", version: 1, id: "shared", sources: [{ name: "test/assets", git: f.repository }], assets: [{ coordinate: "test/assets/a", placements: [{ target: "test-adapter", scope: "project" }] }] }));
    await f.service.execute({ kind: "bundle.apply", file }); files.push(file);
  }
  return { ...f, files };
}

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
