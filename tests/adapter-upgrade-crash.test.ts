import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { access, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { upgradeFixture } from "./helpers/adapter-upgrade.js";
import { StateStore } from "../src/storage/state-store.js";
for (const point of ["prepared", "after-record", "after-write", "after-state", "committed"]) test(`adapter upgrade SIGKILL ${point}`, { timeout: 20000 }, async t => {
  const f = await upgradeFixture(t), request = await f.request(), before = await new StateStore(f.home).read();
  const target = path.join(f.project, ".test-adapter/next/a");
  const child = fork(new URL("./helpers/adapter-upgrade-child.js", import.meta.url), [f.home, f.project, f.userHome, f.next, request.authorizedSignature, point, ["after-record", "after-write"].includes(point) ? target : ""], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  t.after(() => { child.kill("SIGKILL"); });
  const exited = once(child, "exit");
  const ready = await Promise.race([once(child, "message"), exited.then(() => { throw new Error("Child exited early"); })]);
  assert.equal(ready[0], "ready"); child.kill("SIGKILL"); await exited;
  if (point === "after-write") { await assert.rejects(f.service.recover(), { code: "RECOVERY_REQUIRED" }); await access(path.join(f.home, "transaction.json")); return; }
  await f.service.recover(); const after = await new StateStore(f.home).read();
  if (point === "committed") { assert.equal(after.adapters.registrations.find(a => a.name === request.name)!.signature, request.authorizedSignature); await access(target); }
  else { assert.deepEqual(after, before); await access(before.install.operations[0]!.resource.path); }
});
