import assert from "node:assert/strict";
import test from "node:test";
import { emit, measured, observe } from "../src/observability/measure.js";
test("observers cannot change outcomes and concurrent scopes do not share events", async () => {
  const a: string[] = [], b: string[] = [];
  await Promise.all([observe(e => { a.push(e.name); }, () => measured("a", async () => { await Promise.resolve(); emit("a.bytes", 3, "bytes"); })), observe(e => { b.push(e.name); }, () => measured("b", async () => undefined))]);
  assert.deepEqual(a, ["a.bytes", "a"]); assert.deepEqual(b, ["b"]);
  assert.equal(await observe(() => { throw new Error("observer"); }, () => measured("ok", async () => 42)), 42);
  assert.equal(await observe(async () => { throw new Error("async observer"); }, () => measured("ok", async () => 42)), 42);
  await assert.rejects(observe(() => { throw new Error("observer"); }, () => measured("bad", async () => { throw new Error("business"); })), /business/);
});
