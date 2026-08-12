import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const releaseCheck = path.resolve("scripts/release-check.mjs");

test("release source metadata is synchronized", async () => {
  const result = await execFileAsync(process.execPath, [releaseCheck, "v0.5.1"], { encoding: "utf8" });

  assert.match(result.stdout, /harnessbrew@0\.5\.1 \(v0\.5\.1\)/);
});

test("release source verification rejects a mismatched tag", async () => {
  await assert.rejects(
    execFileAsync(process.execPath, [releaseCheck, "v0.5.0"], { encoding: "utf8" }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /release tag v0\.5\.0 must match v0\.5\.1/);
      return true;
    }
  );
});
