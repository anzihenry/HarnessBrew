import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { runCli } from "../src/cli.js";
import {
  addAdapterPlugin,
  listAdapterPlugins,
  loadAdapterPlugins,
  removeAdapterPlugin
} from "../src/core/adapter-plugins.js";
import { hasTargetAdapter } from "../src/core/targets/registry.js";
import { addFormula, createTapRepository } from "./helpers/git.js";

function captureIO(): {
  stdout: string[];
  stderr: string[];
  io: { stdout: (message: string) => void; stderr: (message: string) => void };
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (message) => stdout.push(message),
      stderr: (message) => stderr.push(message)
    }
  };
}

async function createAdapterModule(root: string, name: string, version = "1.0.0"): Promise<string> {
  const filePath = path.join(root, `${name}.mjs`);
  await writeFile(filePath, `import path from "node:path";
export default {
  apiVersion: 1,
  name: ${JSON.stringify(name)},
  version: ${JSON.stringify(version)},
  capabilities: {
    skill: "symlink-directory",
    agent: "symlink-file",
    workflow: "symlink-file",
    instruction: "symlink-file",
    prompt: "symlink-file",
    mcp: "unsupported",
    adapter: "unsupported"
  },
  plan(receipt, context = {}) {
    const strategy = this.capabilities[receipt.kind];
    if (strategy === "unsupported") {
      return { target: this.name, coordinate: receipt.coordinate, operations: [] };
    }
    return {
      target: this.name,
      coordinate: receipt.coordinate,
      operations: [{
        strategy,
        source: receipt.kind === "skill" ? receipt.cellarPath : path.join(receipt.cellarPath, receipt.entry),
        destination: path.join(context.root, receipt.coordinate.split("/").at(-1))
      }]
    };
  }
};
`, "utf8");
  return filePath;
}

test("Adapter plugin state explicitly adds, loads, and removes trusted modules", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-adapter-plugin-"));
  const home = path.join(root, "home");
  const modulePath = await createAdapterModule(root, "plugin-lifecycle");

  const added = await addAdapterPlugin(home, modulePath);
  assert.equal(added.name, "plugin-lifecycle");
  assert.match(added.module, /^file:/u);
  assert.deepEqual((await listAdapterPlugins(home)).map((record) => record.name), ["plugin-lifecycle"]);
  assert.equal(hasTargetAdapter("plugin-lifecycle"), false);

  const unload = await loadAdapterPlugins(home);
  assert.equal(hasTargetAdapter("plugin-lifecycle"), true);
  unload();
  assert.equal(hasTargetAdapter("plugin-lifecycle"), false);

  assert.equal((await removeAdapterPlugin(home, "plugin-lifecycle")).name, "plugin-lifecycle");
  assert.deepEqual(await listAdapterPlugins(home), []);
});

test("CLI-managed Adapter plugins participate in install and are unloaded between commands", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-adapter-cli-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, "target");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "review", { targets: ["plugin-cli"] });
  const modulePath = await createAdapterModule(root, "plugin-cli");
  const output = captureIO();

  assert.equal(await runCli(["adapter", "add", modulePath], output.io, { home }), 0);
  assert.equal(hasTargetAdapter("plugin-cli"), false);
  assert.equal(await runCli(["adapter", "list"], output.io, { home }), 0);
  assert.match(output.stdout.join("\n"), /plugin-cli\s+1\.0\.0\s+file:/u);
  assert.equal(await runCli(["tap", "add", "personal/agents", repository, "--trust"], output.io, { home }), 0);
  assert.equal(await runCli([
    "install", "review", "--target", "plugin-cli", "--target-root", targetRoot
  ], output.io, { home }), 0);
  assert.equal((await lstat(path.join(targetRoot, "review"))).isSymbolicLink(), true);
  assert.equal(hasTargetAdapter("plugin-cli"), false);

  assert.equal(await runCli(["adapter", "remove", "plugin-cli"], output.io, { home }), 0);
  assert.equal(await runCli([
    "link", "review", "--target", "plugin-cli", "--target-root", targetRoot
  ], output.io, { home }), 1);
  assert.match(output.stderr.join("\n"), /Target adapter is not registered: plugin-cli/u);
});

test("configured Adapter identity changes fail closed until explicitly reviewed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-adapter-identity-"));
  const home = path.join(root, "home");
  const modulePath = await createAdapterModule(root, "identity-test");
  await addAdapterPlugin(home, modulePath);
  const statePath = path.join(home, "adapters.json");
  const state = JSON.parse(await readFile(statePath, "utf8")) as {
    adapters: Array<{ version: string }>;
  };
  const first = state.adapters[0];
  if (first === undefined) throw new Error("missing Adapter record");
  first.version = "2.0.0";
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  const output = captureIO();

  assert.equal(await runCli(["install", "missing", "--target", "identity-test"], output.io, { home }), 1);
  assert.match(output.stderr.join("\n"), /changed identity.*remove and add it again after review/u);
  assert.equal(hasTargetAdapter("identity-test"), false);
});

test("Adapter plugin mutations support dry-run rollback", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-adapter-preview-"));
  const home = path.join(root, "home");
  const modulePath = await createAdapterModule(root, "preview-plugin");
  const output = captureIO();

  assert.equal(await runCli(["adapter", "add", modulePath, "--dry-run", "--json"], output.io, { home }), 0);
  const envelope = JSON.parse(output.stdout[0] ?? "") as {
    result: { name: string };
    changes: Array<{ path: string }>;
  };
  assert.equal(envelope.result.name, "preview-plugin");
  assert.ok(envelope.changes.some((change) => change.path === path.join(home, "adapters.json")));
  assert.deepEqual(await listAdapterPlugins(home), []);
});

test("Adapter modules must use an explicit supported export and specifier", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-adapter-invalid-"));
  const home = path.join(root, "home");
  const invalidModule = path.join(root, "invalid.mjs");
  await writeFile(invalidModule, "export const value = 1;\n", "utf8");

  await assert.rejects(addAdapterPlugin(home, "./relative.mjs"), /Invalid Adapter module specifier/u);
  await assert.rejects(addAdapterPlugin(home, invalidModule), /must export a default Adapter or named 'adapter'/u);
});
