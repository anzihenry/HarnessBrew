import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { nodeGitClient, type GitClient, type GitCommand } from "../src/ports/io.js";

test("Git boundary accepts replaceable command handlers and real local repositories", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-git-port-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls: GitCommand[] = [];
  const fake: GitClient = { async run(command) { calls.push(command); return "fake-commit"; } };
  assert.equal(await fake.run({ args: ["rev-parse", "HEAD"], cwd: root }), "fake-commit");
  assert.deepEqual(calls[0]?.args, ["rev-parse", "HEAD"]);
  await nodeGitClient.run({ args: ["init", "--initial-branch=main"], cwd: root });
  assert.equal(await nodeGitClient.run({ args: ["rev-parse", "--is-inside-work-tree"], cwd: root }), "true");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(nodeGitClient.run({ args: ["status"], cwd: root, signal: controller.signal }), { name: "AbortError" });
});
