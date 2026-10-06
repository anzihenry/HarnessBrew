import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createApplication } from "../src/application/service.js";
import { nodeApplicationDependencies } from "../src/application/dependencies.js";
import { applicationFixture } from "./helpers/application.js";

test("application source, document and storage boundaries are replaceable without globals", async t => {
  const f = await applicationFixture(t); await f.add("a");
  const failure = new Error("source gate");
  const blocked = createApplication(f.options, { sources: () => ({ prepare: async () => { throw failure; }, prepareSelection: async () => { throw failure; } }) });
  await assert.rejects(blocked.plan({ kind: "tap.add", name: "test/assets", url: f.repository }), error => error === failure);
  await f.register();
  const badDocuments = createApplication(f.options, { documents: { ...nodeApplicationDependencies.documents, write: async () => { throw new Error("document fault"); } } });
  await assert.rejects(badDocuments.plan({ kind: "tap.untrust", name: "test/assets" }), /document fault/);
  const badStorage = createApplication(f.options, { storage: { ...nodeApplicationDependencies.storage, read: async () => { throw new Error("storage fault"); } } });
  await assert.rejects(badStorage.query({ kind: "list" }), /storage fault/);
  await Promise.all([blocked.close(), badDocuments.close(), badStorage.close()]);
});
test("architecture checker rejects forbidden imports including type-only and dynamic ones", async () => {
  const { violations } = await import(pathToFileURL(path.resolve("scripts/check-architecture.mjs")).href);
  assert.equal(violations("domain/a.ts", 'import type { X } from "../application/types.js";').length, 1);
  assert.equal(violations("resolution/a.ts", 'await import("node:fs/promises")').length, 1);
  assert.equal(violations("diagnostics/a.ts", 'import type { X } from "../application/types.js";').length, 1);
  assert.equal(violations("cli.ts", 'import { x } from "./execution/files.js";').length, 1);
  assert.equal(violations("domain/a.ts", 'import path from "node:path"; import { hash } from "./identity.js";').length, 0);
});
