import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { applicationFixture } from "./helpers/application.js";
import { builtinIdentity } from "../src/application/adapters.js";

test("static upgrade inspection never imports candidates and signs entry and dependency bytes", async t => {
  const f = await applicationFixture(t), plugin = path.join(f.root, "plugin"), marker = path.join(f.root, "imported");
  await mkdir(plugin);
  await writeFile(path.join(plugin, "package.json"), JSON.stringify({ type: "module", harnessbrew: { format: "harnessbrew.adapter-package", version: 1, name: "test-adapter", adapterVersion: "1", entry: "index.js" } }));
  await writeFile(path.join(plugin, "index.js"), 'export default { protocol:"harnessbrew.adapter/1",name:"test-adapter",version:"1",supportedKinds:["skill"],requiredCapabilities:["link-directory"],plan:async()=>({operations:[]}) };');
  await f.service.execute({ kind: "adapter.add", module: plugin, capabilities: ["link-directory"] });
  await writeFile(path.join(plugin, "index.js"), `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)},'imported'); throw new Error('must not execute');`);
  const first = await f.service.inspectAdapterUpgrade({ name: "test-adapter", module: plugin });
  assert.notEqual(first.current.signature, first.candidate.signature);
  assert.equal(first.requiredCapabilities, null);
  assert.ok(first.signatureCoverage.includes("index.js"));
  await assert.rejects(access(marker), { code: "ENOENT" });
  await writeFile(path.join(plugin, "dependency.js"), "export const value = 1;");
  const second = await f.service.inspectAdapterUpgrade({ name: "test-adapter", module: plugin });
  assert.notEqual(first.candidate.signature, second.candidate.signature);
  await assert.rejects(access(marker), { code: "ENOENT" });
});

test("built-in inspection reports the emitted runtime closure and installed dependants", async t => {
  const f = await applicationFixture(t); await f.add("a"); await f.register();
  await f.service.execute({ kind: "asset.install", coordinate: "a", placements: [f.placement] });
  const report = await f.service.inspectAdapterUpgrade({ name: "openai-codex", module: "builtin:codex" });
  assert.equal(report.candidate.signature, (await builtinIdentity()).signature);
  assert.equal(report.signatureRule, "harnessbrew.builtin-closure/1");
  assert.ok(report.signatureCoverage.includes("domain/validation.js"));
  assert.ok(report.signatureCoverage.includes("planning/config.js"));
  assert.equal(report.affectedAssets[0]?.asset, "test/assets/a");
  assert.equal("planId" in report, false);
});
