import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { installFormula, listInstalled, uninstallFormula } from "../src/core/installations.js";
import { addTap } from "../src/core/taps.js";
import { installForTarget, linkFormula } from "../src/core/targets.js";
import { addFormula, createTapRepository } from "./helpers/git.js";

test("Codex adapter links skill entries and uninstall removes owned links", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-targets-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "code-review");
  await addTap(home, "personal/agents", repository);

  const [receipt] = await installForTarget(home, "code-review", "openai-codex", { root: targetRoot });
  assert.ok(receipt);
  const destination = path.join(targetRoot, "skills", "code-review", "content.md");
  assert.equal((await lstat(destination)).isSymbolicLink(), true);
  assert.match(await readFile(destination, "utf8"), /code-review/);

  await uninstallFormula(home, "code-review");
  await assert.rejects(lstat(destination), /ENOENT/);
});

test("Claude adapter maps workflows to commands", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-targets-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".claude");
  const repository = await createTapRepository(root);
  await addFormula(repository, "workflows", "release", { targets: ["claude-code"] });
  await addTap(home, "personal/agents", repository);

  await installForTarget(home, "release", "claude-code", { root: targetRoot });
  assert.equal((await lstat(path.join(targetRoot, "commands", "release.md"))).isSymbolicLink(), true);
});

test("linking rejects unowned target files and uninstall detects link replacement", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-targets-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "code-review");
  await addTap(home, "personal/agents", repository);
  await installFormula(home, "code-review");

  const destination = path.join(targetRoot, "skills", "code-review", "content.md");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, "user content\n", "utf8");
  await assert.rejects(linkFormula(home, "code-review", "openai-codex", { root: targetRoot }), /not managed/);

  await rm(destination);
  await linkFormula(home, "code-review", "openai-codex", { root: targetRoot });
  await rm(destination);
  await writeFile(destination, "replacement\n", "utf8");
  await assert.rejects(uninstallFormula(home, "code-review"), /Installed target was modified/);
  assert.equal((await listInstalled(home)).length, 1);
});
