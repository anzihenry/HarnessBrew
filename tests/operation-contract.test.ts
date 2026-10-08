import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { createApplication } from "../src/application/service.js";
import type { OperationEffect, OperationOptions, ProgressEvent } from "../src/index.js";
import { stableId } from "../src/domain/identity.js";
import { applicationFixture } from "./helpers/application.js";
function exhaustive(effect: OperationEffect): string {
  switch (effect.kind) {
    case "asset": return effect.change.asset;
    case "metadata": return effect.operation;
    case "adapter-upgrade": return effect.after.name;
    default: { const never: never = effect; return never; }
  }
}
test("operation controls are separate from saved data and callback failures cannot alter outcomes", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  const events: ProgressEvent[] = [], controller = new AbortController();
  const preview = await f.service.plan({ kind: "asset.install", coordinate: "a" }, { signal: controller.signal, timeoutMs: 10000, onProgress: event => { events.push(event); throw new Error("observer failed"); } });
  assert.ok(preview.effects.some(e => exhaustive(e).endsWith("/a")));
  assert.equal(events[0]?.phase, "prepare"); assert.equal(events.at(-1)?.phase, "complete");
  assert.ok(events.some(e => e.phase === "lock-wait"));
  const cache = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`);
  const saved = await readFile(path.join(cache, "plans", `${preview.planId}.json`), "utf8");
  for (const key of ["signal", "timeoutMs", "onProgress", "effects"]) assert.ok(!Object.hasOwn(JSON.parse(saved).saved, key));
  const result = await f.service.apply(preview.planId, { onProgress: async () => { throw new Error("async observer"); } });
  assert.equal(result.outcome, "committed"); assert.equal(result.maintenance, "complete"); assert.equal(result.effects[0]?.kind, "asset");
});
test("pre-aborted, zero deadline and invalid options do not initialize Home", async t => {
  const f = await applicationFixture(t), controller = new AbortController(); controller.abort();
  const request = { kind: "tap.add" as const, name: "test/assets", url: f.repository };
  await assert.rejects(f.service.execute(request, { signal: controller.signal }), { code: "OPERATION_ABORTED" });
  await assert.rejects(f.service.execute(request, { timeoutMs: 0 }), { code: "OPERATION_TIMEOUT" });
  await assert.rejects(f.service.execute(request, { timeoutMs: -1 }), { code: "INVALID_ARGUMENT" });
  await assert.rejects(f.service.execute(request, { bogus: true } as unknown as OperationOptions), { code: "INVALID_ARGUMENT" });
  assert.ok(!(await readdir(f.root)).includes("home"));
});
test("committed cleanup failure is machine-readable and metadata effects preserve committed revision", async t => {
  const f = await applicationFixture(t); await f.register();
  const service = createApplication(f.options, { transactionFault: point => { if (point === "before-cleanup") throw new Error("cleanup failed"); } });
  t.after(() => service.close());
  const result = await service.execute({ kind: "tap.untrust", name: "test/assets" });
  assert.equal(result.outcome, "committed"); assert.equal(result.maintenance, "recovery-required");
  const effect = result.effects[0]; assert.equal(effect?.kind, "metadata");
  if (effect?.kind === "metadata") assert.equal(effect.after.revision, result.committedRevision);
  await f.service.recover();
  const noop = await f.service.execute({ kind: "tap.untrust", name: "test/assets" });
  assert.equal(noop.outcome, "unchanged"); assert.deepEqual(noop.effects, []);
});
