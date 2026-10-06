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
