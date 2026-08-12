import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { bundleCleanup, bundleInstall, lockfilePath, readHarnessfile } from "../src/core/bundle.js";
import { listInstalled } from "../src/core/installations.js";
import { addFormula, createTapRepository } from "./helpers/git.js";

test("bundle install locks taps and dependency closure and cleanup removes unmanaged formulas", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-bundle-"));
  const home = path.join(root, "home");
  const targetRoot = path.join(root, ".codex");
  const repository = await createTapRepository(root);
  await addFormula(repository, "instructions", "guardrails");
  await addFormula(repository, "skills", "code-review", { dependencies: ["personal/agents/guardrails"] });
  const harnessfile = path.join(root, "Harnessfile");
  await writeFile(harnessfile, `schemaVersion: 1
taps:
  - name: personal/agents
    git: ${JSON.stringify(repository)}
assets:
  - formula: personal/agents/code-review
    targets: [openai-codex]
`, "utf8");

  const lock = await bundleInstall(home, harnessfile, { targetRoots: { "openai-codex": targetRoot } });
  assert.equal(lock.taps.length, 1);
  assert.deepEqual(lock.assets.map((asset) => asset.formula), [
    "personal/agents/code-review",
    "personal/agents/guardrails"
  ]);
  assert.deepEqual(JSON.parse(await readFile(lockfilePath(harnessfile), "utf8")), lock);

  await writeFile(harnessfile, `schemaVersion: 1
taps:
  - name: personal/agents
    git: ${JSON.stringify(repository)}
assets: []
`, "utf8");
  const cleanup = await bundleCleanup(home, harnessfile);
  assert.deepEqual(new Set(cleanup.removed), new Set([
    "personal/agents/code-review",
    "personal/agents/guardrails"
  ]));
  assert.deepEqual(await listInstalled(home), []);
});

test("bundle lock reproduces an exact Tap commit in a new home", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-bundle-"));
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "code-review");
  const harnessfile = path.join(root, "Harnessfile");
  await writeFile(harnessfile, `schemaVersion: 1
taps:
  - name: personal/agents
    git: ${JSON.stringify(repository)}
assets:
  - formula: personal/agents/code-review
    targets: []
`, "utf8");
  const first = await bundleInstall(path.join(root, "home-one"), harnessfile);
  await addFormula(repository, "skills", "code-review", { description: "newer" });
  const second = await bundleInstall(path.join(root, "home-two"), harnessfile);
  assert.equal(second.taps[0]?.commit, first.taps[0]?.commit);
  assert.equal(second.assets[0]?.commit, first.assets[0]?.commit);
});

test("Harnessfile v2 reproduces structured user and project placements with content metadata", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-bundle-v2-"));
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "guardrails", { targets: ["openai-codex", "claude-code"] });
  await addFormula(repository, "skills", "code-review", {
    targets: ["openai-codex", "claude-code"],
    dependencies: ["personal/agents/guardrails"]
  });
  const manifest = `schemaVersion: 2
taps:
  - name: personal/agents
    git: ${JSON.stringify(repository)}
assets:
  - formula: personal/agents/code-review
    targets:
      - target: openai-codex
        scope: user
        root: ./codex-user
      - target: claude-code
        scope: project
        project: ./project
`;
  const firstRoot = path.join(root, "machine-one");
  const secondRoot = path.join(root, "machine-two");
  await mkdir(firstRoot);
  await mkdir(secondRoot);
  const firstFile = path.join(firstRoot, "Harnessfile");
  const secondFile = path.join(secondRoot, "Harnessfile");
  await writeFile(firstFile, manifest);
  await writeFile(secondFile, manifest);

  const first = await bundleInstall(path.join(firstRoot, "home"), firstFile);
  assert.equal(first.schemaVersion, 2);
  if (first.schemaVersion !== 2) throw new Error("expected v2 lock");
  assert.match(first.manifestDigest, /^[0-9a-f]{64}$/u);
  assert.match(first.assets[0]?.digest ?? "", /^[0-9a-f]{64}$/u);
  assert.equal(first.assets.find((asset) => asset.formula.endsWith("/code-review"))?.requested, true);
  assert.equal(first.assets.find((asset) => asset.formula.endsWith("/guardrails"))?.requested, false);
  await copyFile(lockfilePath(firstFile), lockfilePath(secondFile));

  const second = await bundleInstall(path.join(secondRoot, "home"), secondFile);
  assert.deepEqual(second, first);
  const installed = await listInstalled(path.join(secondRoot, "home"));
  for (const receipt of installed) {
    assert.equal(receipt.operations.length, 2);
    assert.ok(receipt.operations.some((operation) => operation.scope === "user"
      && operation.destination.startsWith(path.join(secondRoot, "codex-user"))));
    assert.ok(receipt.operations.some((operation) => operation.scope === "project"
      && operation.projectRoot === path.join(secondRoot, "project")));
  }

  const tampered = JSON.parse(await readFile(lockfilePath(secondFile), "utf8")) as {
    assets: Array<{ digest: string }>;
  };
  if (tampered.assets[0] !== undefined) tampered.assets[0].digest = "0".repeat(64);
  await writeFile(lockfilePath(secondFile), `${JSON.stringify(tampered, null, 2)}\n`);
  await assert.rejects(bundleInstall(path.join(secondRoot, "home"), secondFile), /does not match Harnessfile\.lock/u);
});

test("Harnessfile v2 requires explicit lock refresh and converges removed placements", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-bundle-v2-"));
  const home = path.join(root, "home");
  const repository = await createTapRepository(root);
  await addFormula(repository, "skills", "review", { targets: ["openai-codex"] });
  const harnessfile = path.join(root, "Harnessfile");
  const content = (includeUser: boolean) => `schemaVersion: 2
taps:
  - name: personal/agents
    git: ${JSON.stringify(repository)}
assets:
  - formula: personal/agents/review
    targets:
${includeUser ? "      - target: openai-codex\n        scope: user\n        root: ./user-target\n" : ""}      - target: openai-codex
        scope: project
        project: ./project
`;
  await writeFile(harnessfile, content(true));
  const first = await bundleInstall(home, harnessfile);
  assert.equal((await listInstalled(home))[0]?.operations.length, 2);

  await writeFile(harnessfile, content(false));
  await assert.rejects(bundleInstall(home, harnessfile), /use --update-lock/u);
  assert.equal((await listInstalled(home))[0]?.operations.length, 2);
  const updated = await bundleInstall(home, harnessfile, { updateLock: true });
  assert.equal((await listInstalled(home))[0]?.operations.length, 1);
  assert.notEqual(
    updated.schemaVersion === 2 ? updated.manifestDigest : "",
    first.schemaVersion === 2 ? first.manifestDigest : ""
  );
});

test("Harnessfile v2 rejects unknown fields and invalid or duplicate placements", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-bundle-v2-"));
  const harnessfile = path.join(root, "Harnessfile");
  const invalid = [
    `schemaVersion: 2\ntaps: []\nassets: []\nunknown: true\n`,
    `schemaVersion: 2\ntaps: []\nassets:\n  - formula: personal/agents/review\n    targets:\n      - target: openai-codex\n        scope: project\n`,
    `schemaVersion: 2\ntaps: []\nassets:\n  - formula: personal/agents/review\n    targets:\n      - &target\n        target: openai-codex\n        scope: user\n      - *target\n`
  ];
  for (const content of invalid) {
    await writeFile(harnessfile, content);
    await assert.rejects(readHarnessfile(harnessfile), /Unknown Harnessfile field|must declare project|duplicate Target/u);
  }
});
