import assert from "node:assert/strict";
import { lstat, readFile } from "node:fs/promises";

export async function pathExists(candidate) {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function assertPathMissing(candidate, message = `Expected path to be absent: ${candidate}`) {
  assert.equal(await pathExists(candidate), false, message);
}

export async function readJsonFile(candidate) {
  return JSON.parse(await readFile(candidate, "utf8"));
}

export function assertSuccessfulEnvelope(envelope, command) {
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.exitCode, 0);
  assert.equal(envelope.command, command);
  assert.deepEqual(envelope.diagnostics, []);
}

export function assertFailedEnvelope(envelope, command, messagePattern) {
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.exitCode, 1);
  assert.equal(envelope.command, command);
  assert.match(envelope.error?.message ?? "", messagePattern);
}
