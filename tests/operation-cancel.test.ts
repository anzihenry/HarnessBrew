import assert from "node:assert/strict";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createApplication } from "../src/application/service.js";
import { SourceManager } from "../src/sources/manager.js";
import { nodeGitClient } from "../src/ports/io.js";
import { runOperation } from "../src/observability/operation.js";
import { withFileLock } from "../src/transactions/file-lock.js";
import { stableId } from "../src/domain/identity.js";
import { applicationFixture } from "./helpers/application.js";
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
test("cancelling Home lock wait removes only own tickets and releases the cache lease", async t => {
  const f = await applicationFixture(t); await f.register();
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>(r => { entered = r; });
  const held = withFileLock(path.join(f.home, ".store.lock"), async () => { entered(); await new Promise<void>(r => { release = r; }); });
  await ready; const controller = new AbortController();
  const operation = f.service.execute({ kind: "tap.trust", name: "test/assets" }, { signal: controller.signal });
  const rejected = assert.rejects(operation, { code: "OPERATION_ABORTED" });
  await sleep(100); controller.abort(); await rejected;
  assert.equal((await readdir(path.join(f.home, ".store.lock"))).length, 1);
  const cache = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`);
  assert.deepEqual(await readdir(path.join(cache, "leases")), []);
  release(); await held;
});
test("operation deadline covers lock waiting and abort after preparation starts no transaction", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  await withFileLock(path.join(f.home, ".store.lock"), async () => {
    await assert.rejects(f.service.query({ kind: "list" }, { timeoutMs: 30 }), { code: "OPERATION_TIMEOUT" });
  });
  const controller = new AbortController();
  const service = createApplication(f.options, { preparationCheckpoint: () => { controller.abort(); } }); t.after(() => service.close());
  const before = await readFile(path.join(f.home, "CURRENT"), "utf8");
  await assert.rejects(service.execute({ kind: "asset.install", coordinate: "a" }, { signal: controller.signal }), { code: "OPERATION_ABORTED" });
  assert.equal(await readFile(path.join(f.home, "CURRENT"), "utf8"), before);
  assert.ok(!(await readdir(f.home)).includes("transaction.json"));
});
test("Git cancellation waits for a TERM-resistant child to exit and deadline uses the same path", { timeout: 10000 }, async t => {
  const f = await applicationFixture(t), bin = path.join(f.root, "bin"), pidFile = path.join(f.root, "pid");
  await mkdir(bin);
  const executable = path.join(bin, "git");
  await writeFile(executable, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);\n`);
  await chmod(executable, 0o755);
  const previous = process.env.PATH; process.env.PATH = `${bin}${path.delimiter}${previous}`;
  t.after(() => { process.env.PATH = previous; });
  const controller = new AbortController();
  const operation = runOperation({ signal: controller.signal }, "prepare", () => nodeGitClient.run({ cwd: f.root, args: ["fetch"] }));
  const rejected = assert.rejects(operation, { code: "OPERATION_ABORTED" });
  let pid = 0;
  for (let i = 0; i < 100 && !pid; i++) { await sleep(10); pid = Number(await readFile(pidFile, "utf8").catch(() => "0")); }
  assert.ok(pid > 0); controller.abort(); await rejected;
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  await assert.rejects(runOperation({ timeoutMs: 100 }, "prepare", () => nodeGitClient.run({ cwd: f.root, args: ["fetch"] })), { code: "OPERATION_TIMEOUT" });
  const timedPid = Number(await readFile(pidFile, "utf8")); assert.throws(() => process.kill(timedPid, 0), { code: "ESRCH" });
});

test("SDK preparation propagates signal to SourceManager and starts no follow-up Git work", async t => {
  const f = await applicationFixture(t), controller = new AbortController(); let calls = 0;
  const service = createApplication(f.options, { sources: root => new SourceManager(root, {
    run: async command => { calls++; assert.ok(command.signal); queueMicrotask(() => controller.abort());
      return new Promise<string>((_, reject) => command.signal!.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true })); },
    bytes: async () => { throw new Error("must not read objects after cancellation"); }
  }) }); t.after(() => service.close());
  await assert.rejects(service.plan({ kind: "tap.add", name: "test/assets", url: f.repository }, { signal: controller.signal }), { code: "OPERATION_ABORTED" });
  assert.equal(calls, 1); assert.ok(!(await readdir(f.root)).includes("home"));
  const cache = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`);
  assert.deepEqual(await readdir(path.join(cache, "leases")), []);
  assert.deepEqual(await readdir(path.join(cache, "sources", "repositories")), []);
});
