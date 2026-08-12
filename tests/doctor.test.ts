import assert from "node:assert/strict";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { doctor, relinkFormula } from "../src/core/doctor.js";
import { listInstalled } from "../src/core/installations.js";
import { addTap } from "../src/core/taps.js";
import { installForTarget } from "../src/core/targets.js";
import { addFormula, createTapRepository } from "./helpers/git.js";

test("doctor classifies missing and modified targets and relink repairs them", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-doctor-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "review");
  await addFormula(repository, "agents", "reviewer");
  await addTap(home, "personal/agents", repository);
  await installForTarget(home, "review", "openai-codex", { root: targetRoot });
  await installForTarget(home, "reviewer", "openai-codex", { root: targetRoot });
  assert.equal((await doctor(home)).healthy, true);

  const skillDestination = path.join(targetRoot, "skills", "review");
  const agentDestination = path.join(targetRoot, "agents", "reviewer.toml");
  await rm(skillDestination);
  await writeFile(agentDestination, "user replacement\n");
  const broken = await doctor(home);
  assert.deepEqual(broken.findings.map((finding) => finding.kind).sort(), ["target-missing", "target-modified"]);

  await relinkFormula(home, "review", { target: "openai-codex" });
  await relinkFormula(home, "reviewer", { target: "openai-codex" });
  assert.equal((await lstat(skillDestination)).isSymbolicLink(), true);
  assert.match(await readFile(agentDestination, "utf8"), /name = "reviewer"/u);
  assert.equal((await doctor(home)).healthy, true);
});

test("doctor reports Cellar modifications and relink refuses an untrusted source", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-doctor-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".claude");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "review", { targets: ["claude-code"] });
  await addTap(home, "personal/agents", repository);
  const [receipt] = await installForTarget(home, "review", "claude-code", { root: targetRoot });
  assert.ok(receipt);
  await writeFile(path.join(receipt.cellarPath, "SKILL.md"), "tampered\n");

  const report = await doctor(home, "review");
  assert.equal(report.findings.some((finding) => finding.kind === "cellar-modified"), true);
  await assert.rejects(relinkFormula(home, "review"), /Installed files were modified/u);
  assert.equal((await listInstalled(home)).length, 1);
});
