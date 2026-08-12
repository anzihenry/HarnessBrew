import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  assert.deepEqual(output.stdout, ["0.6.2"]);
});

test("unknown commands fail with a useful error", async () => {
  const output = captureIO();
  const exitCode = await runCli(["missing"], output.io);

  assert.equal(exitCode, 1);
  assert.match(output.stderr.join("\n"), /Unknown command: missing/);
});

test("JSON mode emits one versioned envelope for success and failure", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-cli-json-"));
  const output = captureIO();
  assert.equal(await runCli(["version", "--json"], output.io), 0);
  assert.equal(output.stdout.length, 1);
  assert.deepEqual(JSON.parse(output.stdout[0] ?? ""), {
    schemaVersion: 1,
    ok: true,
    command: "version",
    exitCode: 0,
    dryRun: false,
    result: { version: "0.6.2" },
    output: ["0.6.2"],
    diagnostics: []
  });

  output.stdout.length = 0;
  assert.equal(await runCli(["missing", "--json"], output.io), 1);
  const failure = JSON.parse(output.stdout[0] ?? "") as {
    ok: boolean;
    diagnostics: string[];
    error: { code: string; message: string };
  };
  assert.equal(failure.ok, false);
  assert.match(failure.diagnostics.join("\n"), /Unknown command: missing/u);
  assert.deepEqual(failure.error, {
    code: "COMMAND_FAILED",
    message: "Unknown command: missing"
  });

  output.stdout.length = 0;
  assert.equal(await runCli(
    ["tap", "remove", "missing/tap", "--json"],
    output.io,
    { home: path.join(root, "home") }
  ), 1);
  const domainFailure = JSON.parse(output.stdout[0] ?? "") as { error: { code: string }; diagnostics: string[] };
  assert.equal(domainFailure.error.code, "HARNESSBREW_ERROR");
  assert.match(domainFailure.diagnostics.join("\n"), /Tap not found/u);
  assert.deepEqual(output.stderr, []);
});

test("tap commands expose the Git source lifecycle", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-cli-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);
  const output = captureIO();

  assert.equal(await runCli(["tap", "add", "personal/agents", repository], output.io, { home }), 0);
  assert.equal(await runCli(["tap", "list"], output.io, { home }), 0);
  assert.match(output.stdout.join("\n"), /personal\/agents.*untrusted/u);
  output.stdout.length = 0;
  assert.equal(await runCli(["tap", "trust", "personal/agents"], output.io, { home }), 0);
  assert.equal(await runCli(["tap", "list"], output.io, { home }), 0);
  assert.match(output.stdout.join("\n"), /personal\/agents.*trusted/u);
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

  await runCli(["tap", "add", "personal/agents", repository, "--trust"], output.io, { home });
  assert.equal(await runCli(["install", "code-review"], output.io, { home }), 0);
  assert.equal(await runCli(["list"], output.io, { home }), 0);
  assert.match(output.stdout.join("\n"), /Installed personal\/agents\/code-review/);
  assert.equal(await runCli(["uninstall", "code-review"], output.io, { home }), 0);
});

test("dry-run reports installation changes without persisting Cellar or Target state", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-cli-preview-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "review");
  const setup = captureIO();
  await runCli(["tap", "add", "personal/agents", repository, "--trust"], setup.io, { home });
  const output = captureIO();

  assert.equal(await runCli([
    "install", "review", "--target", "openai-codex", "--target-root", targetRoot, "--dry-run", "--json"
  ], output.io, { home }), 0);
  const result = JSON.parse(output.stdout[0] ?? "") as {
    dryRun: boolean;
    result: Array<{ coordinate: string }>;
    changes: Array<{ path: string; before: { kind: string }; after: { kind: string } }>;
  };
  assert.equal(result.dryRun, true);
  assert.equal(result.result[0]?.coordinate, "personal/agents/review");
  assert.ok(result.changes.some((change) => change.path === path.join(targetRoot, "skills", "review")
    && change.before.kind === "missing" && change.after.kind === "symlink"));
  await assert.rejects(lstat(path.join(targetRoot, "skills", "review")), /ENOENT/u);

  const listed = captureIO();
  assert.equal(await runCli(["list", "--json"], listed.io, { home }), 0);
  const listResult = JSON.parse(listed.stdout[0] ?? "") as { output: string[] };
  assert.deepEqual(listResult.output, []);
});

test("update, outdated, and upgrade expose the Git release lifecycle", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-cli-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "code-review");
  const output = captureIO();

  await runCli(["tap", "add", "personal/agents", repository, "--trust"], output.io, { home });
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

test("link and unlink CLI commands select user or project scope", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-cli-"));
  const home = path.join(root, "home");
  const userRoot = path.join(root, "user-codex");
  const projectRoot = path.join(root, "project");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "review");
  const output = captureIO();
  await runCli(["tap", "add", "personal/agents", repository, "--trust"], output.io, { home });

  assert.equal(await runCli([
    "install", "review", "--target", "openai-codex", "--scope", "user", "--target-root", userRoot
  ], output.io, { home }), 0);
  assert.equal(await runCli([
    "link", "review", "--target", "openai-codex", "--scope", "project", "--project", projectRoot
  ], output.io, { home }), 0);
  const userDestination = path.join(userRoot, "skills", "review");
  const projectDestination = path.join(projectRoot, ".agents", "skills", "review");
  assert.equal((await lstat(userDestination)).isSymbolicLink(), true);
  assert.equal((await lstat(projectDestination)).isSymbolicLink(), true);

  assert.equal(await runCli([
    "unlink", "review", "--target", "openai-codex", "--scope", "project", "--project", projectRoot
  ], output.io, { home }), 0);
  await assert.rejects(lstat(projectDestination), /ENOENT/);
  assert.equal((await lstat(userDestination)).isSymbolicLink(), true);
});

test("doctor and relink CLI commands repair a missing target", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-cli-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".claude");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "review", { targets: ["claude-code"] });
  const output = captureIO();
  await runCli(["tap", "add", "personal/agents", repository, "--trust"], output.io, { home });
  await runCli(["install", "review", "--target", "claude-code", "--target-root", targetRoot], output.io, { home });
  const destination = path.join(targetRoot, "skills", "review");
  await rm(destination);

  assert.equal(await runCli(["doctor", "review"], output.io, { home }), 1);
  assert.match(output.stderr.join("\n"), /target-missing/u);
  assert.equal(await runCli([
    "relink", "review", "--target", "claude-code", "--target-root", targetRoot
  ], output.io, { home }), 0);
  assert.equal((await lstat(destination)).isSymbolicLink(), true);
  assert.equal(await runCli(["doctor", "review"], output.io, { home }), 0);
});
