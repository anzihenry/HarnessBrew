import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveTapPath } from "../src/core/paths.js";
import { addTap, listTaps, removeTap, updateTaps } from "../src/core/taps.js";
import { createTapRepository, commitFile, git } from "./helpers/git.js";

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

test("legacy Tap state remains trusted while malformed trust state is rejected", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-taps-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);
  await addTap(home, "personal/agents", repository);
  const statePath = path.join(home, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8")) as {
    taps: Record<string, { trusted?: unknown; trustedAt?: unknown }>;
  };
  const tap = state.taps["personal/agents"];
  assert.ok(tap);
  delete tap.trusted;
  delete tap.trustedAt;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  assert.equal((await listTaps(home))[0]?.trusted, true);

  tap.trusted = "yes";
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
  await assert.rejects(listTaps(home), /Unsupported HarnessBrew state file/u);
});

test("tap update restores the checkout and state when a candidate is invalid", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-taps-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);
  const added = await addTap(home, "personal/agents", repository);
  await commitFile(repository, "tap.json", '{"schemaVersion":99}\n');

  await assert.rejects(updateTaps(home, "personal/agents"), /Unsupported tap manifest/u);
  assert.equal(await git(resolveTapPath(home, "personal/agents"), "rev-parse", "HEAD"), added.commit);
  assert.equal((await listTaps(home))[0]?.commit, added.commit);
});

test("tap update rejects rewritten history unless rewind is explicitly allowed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-taps-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);
  const added = await addTap(home, "personal/agents", repository);
  const forward = await commitFile(repository, "README.md", "forward\n");
  await updateTaps(home, "personal/agents");

  await git(repository, "reset", "--hard", added.commit);
  const rewritten = await commitFile(repository, "README.md", "rewritten\n");
  await assert.rejects(updateTaps(home, "personal/agents"), /not a fast-forward/u);
  assert.equal((await listTaps(home))[0]?.commit, forward);

  const [update] = await updateTaps(home, "personal/agents", { allowRewind: true });
  assert.equal(update?.after, rewritten);
  assert.equal((await listTaps(home))[0]?.commit, rewritten);
});
