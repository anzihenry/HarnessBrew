import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { addTap, listTaps, removeTap, updateTaps } from "../src/core/taps.js";
import { createTapRepository, commitFile } from "./helpers/git.js";

test("tap lifecycle clones, lists, updates, and removes a Git source", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-taps-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);

  const added = await addTap(home, "personal/agents", repository);
  assert.match(added.commit, /^[0-9a-f]{40}$/);
  assert.deepEqual((await listTaps(home)).map((tap) => tap.name), ["personal/agents"]);

  const nextCommit = await commitFile(repository, "README.md", "updated\n");
  const [update] = await updateTaps(home, "personal/agents");
  assert.equal(update?.changed, true);
  assert.equal(update?.after, nextCommit);

  const state = JSON.parse(await readFile(path.join(home, "state.json"), "utf8")) as {
    taps: Record<string, { commit: string }>;
  };
  assert.equal(state.taps["personal/agents"]?.commit, nextCommit);

  await removeTap(home, "personal/agents");
  assert.deepEqual(await listTaps(home), []);
});

test("tap registration rejects invalid and duplicate names", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-taps-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);

  await assert.rejects(addTap(home, "invalid", repository), /Expected <owner>\/<name>/);
  await addTap(home, "personal/agents", repository);
  await assert.rejects(addTap(home, "personal/agents", repository), /already exists/);
});
