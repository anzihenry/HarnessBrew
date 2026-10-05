import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { access, readFile, rm, writeFile } from "node:fs/promises";
import { applicationFixture } from "./helpers/application.js";
import { StateStore } from "../src/storage/state-store.js";
import { TransactionCoordinator, type ExecutionInput } from "../src/transactions/coordinator.js";
import { stableId } from "../src/domain/identity.js";
import { registryFor } from "../src/application/adapters.js";
import { catalogAssetReader } from "../src/ports/planning.js";

async function damagedFixture(t: Parameters<typeof applicationFixture>[0]) {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  await f.service.execute({ kind: "asset.install", coordinate: "a", placements: [f.placement] });
  const state = await new StateStore(f.home).read(), digest = state.contents[0]!.digest;
  const directory = path.join(f.home, "content", digest.slice(7)), entry = path.join(directory, "SKILL.md");
  const original = await readFile(entry, "utf8");
  return { ...f, state, digest, directory, entry, original };
}

test("public repair restores missing content and target after source cache loss without upgrading", async t => {
  const f = await damagedFixture(t);
  await f.add("a", {}, "remote has moved");
  await rm(f.directory, { recursive: true });
  await rm(path.join(f.project, ".agents", "skills", "a"));
  await rm(f.state.sources.snapshots[0]!.contentLocation, { recursive: true });
  const result = await f.service.execute({ kind: "repair", coordinate: "a" });
  assert.equal(await readFile(f.entry, "utf8"), f.original);
  assert.equal(result.contentChanges![0]!.action, "restore");
  assert.deepEqual((await new StateStore(f.home).read()).install.assets[0]!.commit, f.state.install.assets[0]!.commit);
  assert.equal((await f.service.doctor()).healthy, true);
});

test("modified content needs explicit consent and survives committed repair in quarantine", async t => {
  const f = await damagedFixture(t); await writeFile(f.entry, "user changes");
  await assert.rejects(f.service.execute({ kind: "repair", coordinate: "a" }), { code: "CONTENT_MODIFIED" });
  const result = await f.service.execute({ kind: "repair", coordinate: "a", restoreContent: true });
  assert.equal(await readFile(f.entry, "utf8"), f.original);
  const quarantine = result.contentChanges![0]!.quarantine!;
  assert.equal(await readFile(path.join(quarantine, "SKILL.md"), "utf8"), "user changes");
  assert.equal((await new StateStore(f.home).read()).quarantines[0]!.path, quarantine);
  await f.service.execute({ kind: "cleanup" }); await access(quarantine);
});

for (const point of ["after-quarantine", "before-state", "after-state"] as const) test(`content repair rolls back original content at ${point}`, async t => {
  const f = await damagedFixture(t); await writeFile(f.entry, "preserve this");
  const preview = await f.service.plan({ kind: "repair", coordinate: "a", restoreContent: true });
  const cache = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`);
  const { saved } = JSON.parse(await readFile(path.join(cache, "plans", `${preview.planId}.json`), "utf8"));
  const input: ExecutionInput = { plan: saved.plan, catalog: saved.catalog, restorations: saved.restorations, assets: catalogAssetReader(saved.catalog), adapters: await registryFor(f.state, cache, []) };
  const coordinator = new TransactionCoordinator(f.home, { fault: current => { if (current === point) throw new Error("injected repair failure"); } });
  await assert.rejects(coordinator.apply(input), /injected repair failure/u);
  assert.equal(await readFile(f.entry, "utf8"), "preserve this");
  assert.deepEqual(await new StateStore(f.home).read(), f.state);
  await assert.rejects(access(path.join(f.home, "transaction.json")));
});

test("saved repair refuses content changes after preview", async t => {
  const f = await damagedFixture(t); await rm(f.directory, { recursive: true });
  const preview = await f.service.plan({ kind: "repair", coordinate: "a" });
  const { mkdir } = await import("node:fs/promises"); await mkdir(f.directory); await writeFile(f.entry, "new user data");
  await assert.rejects(f.service.apply(preview.planId), { code: "PLAN_STALE" });
  assert.equal(await readFile(f.entry, "utf8"), "new user data");
});

test("CLI repair exposes content restoration and Doctor distinguishes damage, quarantine and unknown content", async t => {
  const f = await damagedFixture(t); await writeFile(f.entry, "preserve");
  const report = await f.service.doctor();
  assert.ok(report.findings.some(finding => finding.code === "CONTENT_MODIFIED" && finding.actions.includes("repair --restore-content") && finding.affectedAssets?.includes("test/assets/a")));
  const { runCli } = await import("../src/cli.js"); let stdout = "";
  const exit = await runCli(["repair", "a", "--restore-content", "--json"], { stdout: text => { stdout += text; }, stderr: () => undefined }, f.options);
  assert.equal(exit, 0); const result = JSON.parse(stdout).result;
  assert.equal(result.contentChanges[0].digest, f.digest); assert.ok(result.contentChanges[0].bytes > 0); assert.ok(result.contentChanges[0].quarantine);
  assert.deepEqual(result.contentChanges[0].commit, f.state.install.assets[0]!.commit);
  const { mkdir } = await import("node:fs/promises"); await mkdir(path.join(f.home, "content", "unknown"));
  const healthy = await f.service.doctor(); assert.equal(healthy.healthy, true);
  assert.ok(healthy.findings.some(finding => finding.code === "CONTENT_UNREGISTERED"));
  assert.ok(healthy.findings.some(finding => finding.code === "CONTENT_QUARANTINED"));
});
