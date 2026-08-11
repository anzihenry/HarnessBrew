import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../src/cli.js";

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
