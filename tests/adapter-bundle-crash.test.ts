import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { bundleFixture } from "./helpers/adapter-bundles.js";
import { StateStore } from "../src/storage/state-store.js";
for (const index of [0, 1]) for (const point of ["after-record", "after-write"]) test(`joint upgrade SIGKILL ${point} at lock ${index + 1}`, { timeout: 25000 }, async t => {
  const f = await bundleFixture(t), request = await f.request(), before = await new StateStore(f.home).read();
  const locks = await Promise.all(f.files.map(file => readFile(`${file}.lock.json`, "utf8")));
  const child = fork(new URL("./helpers/adapter-upgrade-child.js", import.meta.url), [f.home, f.project, f.userHome, f.next, request.authorizedSignature, point, `${f.files[index]}.lock.json`, JSON.stringify(f.files)], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  t.after(() => { child.kill("SIGKILL"); });
  const exited = once(child, "exit");
  assert.equal((await Promise.race([once(child, "message"), exited.then(() => { throw new Error("Child exited early"); })]))[0], "ready");
  child.kill("SIGKILL"); await exited;
  if (point === "after-write") { await assert.rejects(f.service.recover(), { code: "RECOVERY_REQUIRED" }); await access(path.join(f.home, "transaction.json")); return; }
  await f.service.recover();
  assert.deepEqual(await new StateStore(f.home).read(), before);
  for (let i=0; i<f.files.length; i++) assert.equal(await readFile(`${f.files[i]}.lock.json`, "utf8"), locks[i]);
  for (const op of before.install.operations) await access(op.resource.path);
});
