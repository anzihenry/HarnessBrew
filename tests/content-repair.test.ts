import { once } from "node:events";
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

test("shared content with lost source snapshots is restored once and repairs all affected targets", async t => {
  const f = await applicationFixture(t);
  for (const name of ["a", "b"]) await f.add(name, { kind: "instruction", description: "same" }, "shared instructions");
  await f.register();
  for (const coordinate of ["a", "b"]) await f.service.execute({ kind: "asset.install", coordinate, placements: [f.placement] });
  const state = await new StateStore(f.home).read(); assert.equal(state.contents.length, 1);
  await rm(path.join(f.home, "content", state.contents[0]!.digest.slice(7)), { recursive: true });
  await rm(path.join(f.project, "AGENTS.md"));
  for (const snapshot of state.sources.snapshots) await rm(snapshot.contentLocation, { recursive: true, force: true });
  const result = await f.service.execute({ kind: "repair", coordinate: "b" });
  assert.equal(result.contentChanges!.length, 1); assert.equal(result.contentChanges![0]!.affectedAssets.length, 2);
  assert.equal((await f.service.doctor()).healthy, true);
  await f.service.execute({ kind: "asset.remove", coordinate: "a" }); await f.service.execute({ kind: "cleanup" });
  assert.equal((await new StateStore(f.home).read()).contents.length, 1);
});

for (const checkpoint of ["after-quarantine", "after-record", "after-state", "committed", "after-write"] as const) test(`real SIGKILL recovery for content repair at ${checkpoint}`, { timeout: 30000 }, async t => {
  const { fork } = await import("node:child_process");
  const f = await damagedFixture(t); await writeFile(f.entry, "original user bytes");
  const preview = await f.service.plan({ kind: "repair", coordinate: "a", restoreContent: true });
  const cache = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`);
  const child = fork(new URL("./helpers/content-repair-child.js", import.meta.url), [f.home, cache, preview.planId, checkpoint], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  const exited = once(child, "exit");
  const ready = await Promise.race([once(child, "message"), exited.then(() => { throw new Error("Child exited before checkpoint"); })]);
  assert.equal((ready[0] as { checkpoint: string }).checkpoint, checkpoint);
  child.kill("SIGKILL"); await exited;
  if (checkpoint === "after-write") {
    await assert.rejects(f.service.recover(), { code: "RECOVERY_REQUIRED" });
    await access(path.join(f.home, "transaction.json"));
  } else {
    await f.service.recover();
    assert.equal(await readFile(f.entry, "utf8"), checkpoint === "committed" ? f.original : "original user bytes");
    const state = await new StateStore(f.home).read();
    if (checkpoint === "committed") assert.equal(await readFile(path.join(state.quarantines[0]!.path, "SKILL.md"), "utf8"), "original user bytes");
    else assert.deepEqual(state, f.state);
  }
});

test("external changes to quarantine stop rollback and preserve both locations", async t => {
  const f = await damagedFixture(t); await writeFile(f.entry, "original");
  const preview = await f.service.plan({ kind: "repair", coordinate: "a", restoreContent: true });
  const cache = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`);
  const { saved } = JSON.parse(await readFile(path.join(cache, "plans", `${preview.planId}.json`), "utf8"));
  const { JournalStore } = await import("../src/transactions/journal.js");
  const coordinator = new TransactionCoordinator(f.home, { fault: async point => {
    if (point === "after-quarantine") {
      const journal = (await new JournalStore(f.home).load())!;
      await writeFile(path.join(journal.restorations![0]!.quarantine, "SKILL.md"), "external data"); throw new Error("injected");
    }
  } });
  await assert.rejects(coordinator.apply({ plan: saved.plan, catalog: saved.catalog, restorations: saved.restorations, assets: catalogAssetReader(saved.catalog), adapters: await registryFor(f.state, cache, []) }), { code: "RECOVERY_REQUIRED" });
  const journal = (await new JournalStore(f.home).load())!;
  assert.equal(await readFile(path.join(journal.restorations![0]!.quarantine, "SKILL.md"), "utf8"), "external data");
});

test("repair uses a canonical catalog with multiple historical and selected snapshots", async t => {
  const f = await damagedFixture(t);
  for (const version of [2, 3]) {
    await f.add("a", {}, `---\nname: a\ndescription: test\n---\nversion ${version}\n`);
    await f.service.execute({ kind: "tap.update" });
    if (version === 2) await f.service.execute({ kind: "asset.upgrade", coordinate: "a" });
  }
  await rm(path.join(f.project, ".agents", "skills", "a"));
  await f.service.execute({ kind: "repair", coordinate: "a" });
  assert.match(await readFile(path.join(f.project, ".agents", "skills", "a", "SKILL.md"), "utf8"), /version 2/u);
  assert.equal((await f.service.doctor()).healthy, true);
});

for (const all of [false, true]) test(`repair isolates unrelated damage or restores all digests (all=${all})`, async t => {
  const f = await applicationFixture(t);
  for (const name of ["a", "b"]) await f.add(name);
  await f.register();
  for (const coordinate of ["a", "b"]) await f.service.execute({ kind: "asset.install", coordinate, placements: [f.placement] });
  const before = await new StateStore(f.home).read();
  for (const content of before.contents) await rm(path.join(f.home, "content", content.digest.slice(7)), { recursive: true });
  for (const name of ["a", "b"]) await rm(path.join(f.project, ".agents", "skills", name));
  const result = await f.service.execute(all ? { kind: "repair", all: true } : { kind: "repair", coordinate: "a" });
  assert.equal(result.contentChanges!.length, all ? 2 : 1);
  assert.equal((await f.service.doctor()).healthy, all);
  if (!all) {
    const after = await new StateStore(f.home).read();
    assert.deepEqual(after.install.operations.filter(op => op.asset.endsWith("/b")), before.install.operations.filter(op => op.asset.endsWith("/b")));
    await f.service.execute({ kind: "repair", coordinate: "b" });
    assert.equal((await f.service.doctor()).healthy, true);
  }
});

test("batch repair refuses modified content before publishing any restoration", async t => {
  const f = await applicationFixture(t);
  for (const name of ["a", "b"]) await f.add(name);
  await f.register();
  for (const coordinate of ["a", "b"]) await f.service.execute({ kind: "asset.install", coordinate, placements: [f.placement] });
  const before = await new StateStore(f.home).read();
  const directory = (name: string) => path.join(f.home, "content", before.install.assets.find(a => a.coordinate.endsWith(`/${name}`))!.contentDigest.slice(7));
  await rm(directory("a"), { recursive: true }); await writeFile(path.join(directory("b"), "SKILL.md"), "preserve");
  await assert.rejects(f.service.execute({ kind: "repair", all: true }), { code: "CONTENT_MODIFIED" });
  assert.deepEqual(await new StateStore(f.home).read(), before);
  await assert.rejects(access(directory("a")));
  await f.service.execute({ kind: "repair", coordinate: "a" });
  assert.equal(await readFile(path.join(directory("b"), "SKILL.md"), "utf8"), "preserve");
  const { runCli } = await import("../src/cli.js");
  assert.equal(await runCli(["repair", "--all", "--restore-content"], { stdout: () => {}, stderr: () => {} }, f.options), 0);
  assert.equal((await f.service.doctor()).healthy, true);
});

test("batch content repair rolls back every digest when publication fails", async t => {
  const f = await applicationFixture(t);
  for (const name of ["a", "b"]) await f.add(name);
  await f.register();
  for (const coordinate of ["a", "b"]) await f.service.execute({ kind: "asset.install", coordinate, placements: [f.placement] });
  const state = await new StateStore(f.home).read();
  const directories = state.contents.map(c => path.join(f.home, "content", c.digest.slice(7)));
  for (const directory of directories) await rm(directory, { recursive: true });
  const preview = await f.service.plan({ kind: "repair", all: true });
  const cache = path.join(path.dirname(f.home), `.harnessbrew-cache-${stableId(f.home)}`);
  const { saved } = JSON.parse(await readFile(path.join(cache, "plans", `${preview.planId}.json`), "utf8"));
  const coordinator = new TransactionCoordinator(f.home, { fault: point => { if (point === "before-state") throw new Error("batch failure"); } });
  await assert.rejects(coordinator.apply({ plan: saved.plan, catalog: saved.catalog, restorations: saved.restorations, assets: catalogAssetReader(saved.catalog), adapters: await registryFor(state, cache, []) }), /batch failure/u);
  assert.deepEqual(await new StateStore(f.home).read(), state);
  for (const directory of directories) await assert.rejects(access(directory));
});
