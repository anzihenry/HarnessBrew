import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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

test("help describes HarnessBrew and exits successfully", async () => {
  const output = captureIO();
  const exitCode = await runCli(["help"], output.io);

  assert.equal(exitCode, 0);
  assert.match(output.stdout.join("\n"), /Git-native package manager/);
  assert.deepEqual(output.stderr, []);
});

test("version prints the package version", async () => {
  const output = captureIO();
  const exitCode = await runCli(["--version"], output.io);

  assert.equal(exitCode, 0);
  assert.deepEqual(output.stdout, ["0.3.0"]);
});

test("unknown commands fail with a useful error", async () => {
  const output = captureIO();
  const exitCode = await runCli(["missing"], output.io);

  assert.equal(exitCode, 1);
  assert.match(output.stderr.join("\n"), /Unknown command: missing/);
});

test("tap commands expose the Git source lifecycle", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-cli-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);
  const output = captureIO();

  assert.equal(await runCli(["tap", "add", "personal/agents", repository], output.io, { home }), 0);
  assert.equal(await runCli(["tap", "list"], output.io, { home }), 0);
  assert.match(output.stdout.join("\n"), /personal\/agents/);
  assert.equal(await runCli(["untap", "personal/agents"], output.io, { home }), 0);
});

test("search and info expose formulas from registered taps", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-cli-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "code-review");
  const output = captureIO();

  assert.equal(await runCli(["tap", "add", "personal/agents", repository], output.io, { home }), 0);
  assert.equal(await runCli(["search", "review"], output.io, { home }), 0);
  assert.match(output.stdout.join("\n"), /personal\/agents\/code-review/);
  assert.equal(await runCli(["info", "code-review"], output.io, { home }), 0);
  assert.match(output.stdout.join("\n"), /"kind": "skill"/);
});

test("install, list, and uninstall manage Cellar receipts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-cli-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "code-review");
  const output = captureIO();

  await runCli(["tap", "add", "personal/agents", repository], output.io, { home });
  assert.equal(await runCli(["install", "code-review"], output.io, { home }), 0);
  assert.equal(await runCli(["list"], output.io, { home }), 0);
  assert.match(output.stdout.join("\n"), /Installed personal\/agents\/code-review/);
  assert.equal(await runCli(["uninstall", "code-review"], output.io, { home }), 0);
});

test("update, outdated, and upgrade expose the Git release lifecycle", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-cli-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "code-review");
  const output = captureIO();

  await runCli(["tap", "add", "personal/agents", repository], output.io, { home });
  await runCli(["install", "code-review"], output.io, { home });
  await addFormula(repository, "skills", "code-review", { description: "new review" });
  assert.equal(await runCli(["update"], output.io, { home }), 0);
  assert.equal(await runCli(["outdated"], output.io, { home }), 0);
  assert.equal(await runCli(["upgrade", "code-review"], output.io, { home }), 0);
  assert.match(output.stdout.join("\n"), /Upgraded personal\/agents\/code-review/);
});

test("bundle install rebuilds a declared environment", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-cli-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "code-review");
  const harnessfile = path.join(root, "Harnessfile");
  await writeFile(harnessfile, `taps:
  - name: personal/agents
    git: ${JSON.stringify(repository)}
assets:
  - formula: personal/agents/code-review
    targets: []
`, "utf8");
  const output = captureIO();

  assert.equal(await runCli(["bundle", "install", "--file", harnessfile], output.io, { home }), 0);
  assert.match(output.stdout.join("\n"), /Bundle installed 1 formulas/);
});
