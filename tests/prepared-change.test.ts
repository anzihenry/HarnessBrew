import assert from "node:assert/strict";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { applicationFixture } from "./helpers/application.js";
import { hash, stableId } from "../src/domain/identity.js";
import { canonicalJson } from "../src/domain/validation.js";
import { parsePrepared, sameHomeIdentity } from "../src/application/plan-store.js";

test("saved preparation rejects old, malformed, rehashed nested data and changed Home", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  const preview = await f.service.plan({ kind: "asset.install", coordinate: "a", placements: [f.placement] });
  const file = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`, "plans", `${preview.planId}.json`);
  const original = JSON.parse(await readFile(file, "utf8"));
  assert.equal(original.saved.version, 2); assert.deepEqual(parsePrepared(original.saved), original.saved);
  const variants = [
    { mutate: (v: any) => { v.version = 1; }, code: "PLAN_STALE" },
    { mutate: (v: any) => { v.unknown = true; }, code: "INVALID_PLAN" },
    { mutate: (v: any) => { delete v.homeIdentity; }, code: "INVALID_PLAN" },
    { mutate: (v: any) => { v.plan.fileUpdates[0].after.unknown = true; }, code: "INVALID_PLAN" },
    { mutate: (v: any) => { v.plan.operations = {}; }, code: "INVALID_PLAN" },
    { mutate: (v: any) => { v.resources = ["relative"]; }, code: "INVALID_PLAN" }
  ];
  for (const variant of variants) {
    const saved = structuredClone(original.saved); variant.mutate(saved);
    await writeFile(file, JSON.stringify({ saved, digest: hash(canonicalJson(saved)) }));
    await assert.rejects(f.service.apply(preview.planId), { code: variant.code });
    assert.equal((await f.service.query({ kind: "list" })).assets.length, 0);
  }
  await writeFile(file, JSON.stringify({ ...original, digest: hash("wrong") }));
  await assert.rejects(f.service.apply(preview.planId), { code: "INVALID_PLAN" });
  await writeFile(file, JSON.stringify(original));
  await rename(f.home, `${f.home}-old`); await mkdir(f.home);
  await assert.rejects(f.service.apply(preview.planId), { code: "PLAN_STALE" });
});

test("physical Home identity accepts lexical aliases but rejects inode replacement", () => {
  const a = { physicalPath: "/physical/home/CURRENT", ancestor: { path: "/alias/home", realPath: "/physical/home", device: "1", inode: "2" } };
  assert.equal(sameHomeIdentity(a, { ...a, ancestor: { ...a.ancestor, path: "/physical/home" } }), true);
  assert.equal(sameHomeIdentity(a, { ...a, ancestor: { ...a.ancestor, inode: "3" } }), false);
});
