import assert from "node:assert/strict";
import { access, appendFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { StateStore } from "../src/storage/state-store.js";
import { runCli } from "../src/index.js";
import { upgradeFixture } from "./helpers/adapter-upgrade.js";

test("upgrade preview requires exact authorization before import and preserves current registration and targets", async t => {
  const f = await upgradeFixture(t), marker = path.join(f.root, "loaded");
  await f.plugin("2", "next", `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)},'loaded');`);
  const request = await f.request(), before = await new StateStore(f.home).read();
  await assert.rejects(f.service.plan({ ...request, authorizedSignature: `sha256:${"0".repeat(64)}` }), { code: "ADAPTER_CHANGED" });
  await assert.rejects(access(marker), { code: "ENOENT" });
  await assert.rejects(f.service.plan({ ...request, capabilities: ["write-file"] }), { code: "CAPABILITY_DENIED" });
  await assert.rejects(access(marker), { code: "ENOENT" });
  await assert.rejects(f.service.plan({ ...request, capabilities: [] }), { code: "CAPABILITY_DENIED" });
  const preview = await f.service.plan(request);
  assert.ok(preview.fileUpdates.length >= 2);
  assert.equal(await readFile(marker, "utf8"), "loaded");
  assert.deepEqual(await new StateStore(f.home).read(), before);
  for (const op of before.install.operations) await access(op.resource.path);
  await appendFile(path.join(f.next, "index.js"), "\n// drift\n");
  await assert.rejects(f.service.plan(request), { code: "ADAPTER_CHANGED" });
  await assert.rejects(f.service.apply(preview.planId), { code: "ADAPTER_CHANGED" });
});

test("CLI static inspection has no executable plan and upgrade rejects missing authorization", async t => {
  const f = await upgradeFixture(t);
  let output = "";
  const call = async (args: string[]) => { output = ""; const code = await runCli([...args, "--json"], { stdout: s => { output += s; }, stderr() {} }, f.options); return { code, body: JSON.parse(output) }; };
  const inspected = await call(["adapter", "inspect-upgrade", "test-adapter", "--module", f.next]);
  assert.equal(inspected.code, 0); assert.equal(inspected.body.mode, "query"); assert.equal(inspected.body.result.planId, undefined);
  assert.equal((await call(["adapter", "upgrade", "test-adapter", "--module", f.next, "--dry-run"])).body.error.code, "INVALID_ARGUMENT");
  const request = await f.request();
  const preview = await call(["adapter", "upgrade", "test-adapter", "--module", f.next, "--authorize-signature", request.authorizedSignature, "--capability", "link-directory", "--dry-run"]);
  assert.equal(preview.code, 0); assert.ok(preview.body.result.planId);
});

test("upgrade pins installed content after source updates and only replans selected adapter", async t => {
  const f = await upgradeFixture(t);
  await f.service.execute({ kind: "placement.link", coordinate: "a", placement: { ...f.placement, target: "openai-codex" } });
  const before = await new StateStore(f.home).read();
  await f.add("a", { targets: ["test-adapter", "openai-codex"] }, "new upstream bytes");
  await f.service.execute({ kind: "tap.update", name: "test/assets" });
  const preview = await f.service.plan(await f.request());
  assert.equal(preview.changes.length, 1); // registration only; asset is not upgraded
  assert.ok(preview.fileUpdates.every(u => u.path.includes(".test-adapter")));
  assert.equal(preview.operations.filter(o => o.type === "remove-owned").length, 1);
  assert.equal(preview.operations.filter(o => o.type === "link-directory").length, 1);
  const original = before.install.assets[0]!;
  assert.ok(preview.operations.filter(o => o.type === "link-directory").every(o => o.contentDigest === original.contentDigest));
});

test("upgrade restores exact missing source cache without adopting latest assets", async t => {
  const f = await upgradeFixture(t);
  const before = await new StateStore(f.home).read();
  const { rm } = await import("node:fs/promises");
  for (const snapshot of before.sources.snapshots) await rm(snapshot.contentLocation, { recursive: true, force: true });
  const preview = await f.service.plan(await f.request());
  assert.ok(preview.operations.filter(o => o.type === "link-directory").every(o => o.contentDigest === before.install.assets[0]!.contentDigest));
});

test("manual upgrade refuses active Bundle bindings without changing registration", async t => {
  const f = await upgradeFixture(t), file = path.join(f.project, "Harnessfile.yaml");
  await writeFile(file, JSON.stringify({ format: "harnessbrew.manifest", version: 1, id: "bundle", sources: [{ name: "test/assets", git: f.repository }], assets: [{ coordinate: "test/assets/a", placements: [{ target: "test-adapter", scope: "project" }] }] }));
  await f.service.execute({ kind: "bundle.apply", file });
  const before = await new StateStore(f.home).read();
  await assert.rejects(f.service.plan(await f.request()), (error: any) => error.code === "ADAPTER_IN_USE" && error.details.bindings.length === 1);
  assert.deepEqual(await new StateStore(f.home).read(), before);
});

test("upgrade commits registration and migrated targets together and repeat is idempotent", async t => {
  const f = await upgradeFixture(t), before = await new StateStore(f.home).read();
  const request = await f.request(), preview = await f.service.plan(request);
  await f.service.apply(preview.planId);
  const after = await new StateStore(f.home).read();
  assert.equal(after.adapters.registrations.find(a => a.name === request.name)!.signature, request.authorizedSignature);
  assert.deepEqual(after.install.requirements, before.install.requirements);
  assert.deepEqual(after.install.assets[0]!.commit, before.install.assets[0]!.commit);
  await assert.rejects(access(before.install.operations[0]!.resource.path), { code: "ENOENT" });
  await access(after.install.operations[0]!.resource.path);
  assert.equal((await f.service.execute(request)).committedRevision, after.revision);
});

for (const point of ["after-record", "after-state"] as const) test(`failed upgrade at ${point} restores old registration and target without importing old plugin`, async t => {
  const f = await upgradeFixture(t), before = await new StateStore(f.home).read();
  const { createApplication } = await import("../src/application/service.js");
  const service = createApplication(f.options, { transactionFault: (current, context) => { if (current === point && (point === "after-state" || context.path?.includes("/next/"))) throw new Error("injected"); } });
  const request = await f.request();
  // Old code is unavailable: rollback must use journal evidence only.
  const { rm } = await import("node:fs/promises"); await rm(f.old, { recursive: true });
  await assert.rejects(service.execute(request), /injected/);
  assert.deepEqual(await new StateStore(f.home).read(), before);
  await access(before.install.operations[0]!.resource.path);
  await assert.rejects(access(path.join(f.project, ".test-adapter/next/a")), { code: "ENOENT" });
});
