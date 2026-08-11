import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";

const cliPath = path.resolve("src/cli.js");

function createWorkspaceDir() {
  return mkdtempSync(path.join(os.tmpdir(), "harness-smoke-"));
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8"
  });
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function extractTarGzip(archivePath, outputDir) {
  const tar = gunzipSync(readFileSync(archivePath));
  let offset = 0;

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    offset += 512;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    if (!name) {
      break;
    }

    const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText, 8) || 0;
    const content = tar.subarray(offset, offset + size);
    const outputPath = path.join(outputDir, name);
    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, content);
    offset += size + ((512 - (size % 512)) % 512);
  }
}

test("CLI smoke flow covers init, validate, list, show, export, new, bump-version, and diff", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["--version"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /harnessbrew 0\.3\.0/);

    result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Initialized HarnessBrew workspace/);

    result = runCli(workspaceDir, ["validate"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Workspace is valid/);

    result = runCli(workspaceDir, ["validate", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const validationResult = JSON.parse(result.stdout);
    assert.equal(validationResult.valid, true);
    assert.equal(validationResult.assetCount, 3);
    assert.deepEqual(validationResult.issues, []);

    result = runCli(workspaceDir, ["list"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Assets: 3/);
    assert.match(result.stdout, /agents \(1\)/);
    assert.match(result.stdout, /- agent\.harness-manager @ 0\.1\.0/);
    assert.match(result.stdout, /skills \(1\)/);
    assert.match(result.stdout, /- skill\.prompt-authoring @ 1\.0\.0/);

    result = runCli(workspaceDir, ["list", "--group-by", "owner"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /owner: team-harness \(3\)/);

    result = runCli(workspaceDir, ["list", "--kind", "skill", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const listedSkills = JSON.parse(result.stdout);
    assert.equal(listedSkills.workspace.name, "HarnessBrew");
    assert.equal(listedSkills.filters.kind, "skill");
    assert.equal(listedSkills.groupBy, "kind");
    assert.equal(listedSkills.assetCount, 1);
    assert.equal(listedSkills.assets.length, 1);
    assert.equal(listedSkills.groups.length, 1);
    assert.equal(listedSkills.groups[0].key, "skill");
    assert.equal(listedSkills.assets[0].id, "skill.prompt-authoring");
    assert.equal("renderedContent" in listedSkills.assets[0], false);

    result = runCli(workspaceDir, ["targets"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Targets \(3\)/);
    assert.match(result.stdout, /- generic \[built-in\]/);

    result = runCli(workspaceDir, ["show", "skill", "skill.prompt-authoring"]);
    assert.equal(result.status, 0, result.stderr);
    const shownAsset = JSON.parse(result.stdout);
    assert.equal(shownAsset.id, "skill.prompt-authoring");
    assert.match(shownAsset.renderedContent, /Write prompts that are:/);

    result = runCli(workspaceDir, ["show", "agent", "agent.harness-manager"]);
    assert.equal(result.status, 0, result.stderr);
    const shownAgent = JSON.parse(result.stdout);
    assert.equal(shownAgent.dependencies.length, 2);
    assert.deepEqual(
      shownAgent.dependencies.map((dependency) => `${dependency.kind}:${dependency.id}`),
      ["skill:skill.prompt-authoring", "instruction:instruction.repository-guardrails"]
    );

    result = runCli(workspaceDir, ["show", "agent", "agent.harness-manager", "--resolved"]);
    assert.equal(result.status, 0, result.stderr);
    const resolvedAgent = JSON.parse(result.stdout);
    assert.equal(resolvedAgent.asset.id, "agent.harness-manager");
    assert.equal(resolvedAgent.summary.directDependencyCount, 2);
    assert.equal(resolvedAgent.summary.resolvedAssetCount, 3);
    assert.equal(resolvedAgent.summary.missingDependencyCount, 0);
    assert.equal(resolvedAgent.summary.cycleCount, 0);
    assert.equal(resolvedAgent.resolvedDependencies.length, 2);
    assert.equal(resolvedAgent.graph.assets.length, 3);
    assert.deepEqual(
      resolvedAgent.graph.edges.map((edge) => `${edge.from}->${edge.to}`),
      [
        "agent.harness-manager->instruction.repository-guardrails",
        "agent.harness-manager->skill.prompt-authoring"
      ]
    );

    result = runCli(workspaceDir, ["history", "skill", "skill.prompt-authoring"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /History: skill\.prompt-authoring/);
    assert.match(result.stdout, /Current: 1\.0\.0/);
    assert.match(result.stdout, /Versions: 1/);
    assert.match(result.stdout, /\* 1\.0\.0 \| 2026-06-06 \| Initial skill content\./);
    assert.match(result.stdout, /snapshot: \.snapshots\/1\.0\.0/);

    result = runCli(workspaceDir, ["history", "skill", "skill.prompt-authoring", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const historyResult = JSON.parse(result.stdout);
    assert.equal(historyResult.id, "skill.prompt-authoring");
    assert.equal(historyResult.currentVersion, "1.0.0");
    assert.equal(historyResult.history.length, 1);
    assert.equal(historyResult.history[0].snapshot, ".snapshots/1.0.0");

    result = runCli(workspaceDir, ["show", "skill", "skill.prompt-authoring", "--metadata"]);
    assert.equal(result.status, 0, result.stderr);
    const metadataOnly = JSON.parse(result.stdout);
    assert.equal(metadataOnly.id, "skill.prompt-authoring");
    assert.equal("renderedContent" in metadataOnly, false);

    result = runCli(workspaceDir, ["show", "skill", "skill.prompt-authoring", "--content"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Write prompts that are:/);

    result = runCli(workspaceDir, [
      "new",
      "skill",
      "skill.release-checklist",
      "--description",
      "Release checklist for Harness assets",
      "--owner",
      "team-harness",
      "--tags",
      "release,quality"
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Created \[skill\] skill\.release-checklist @ 1\.0\.0/);

    result = runCli(workspaceDir, [
      "set",
      "skill",
      "skill.release-checklist",
      "--name",
      "Release Checklist",
      "--description",
      "Release readiness checklist for Harness assets",
      "--owner",
      "team-platform",
      "--tags",
      "release,readiness",
      "--targets",
      "generic,openai-codex"
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Updated \[skill\] skill\.release-checklist @ 1\.0\.0/);
    assert.match(result.stdout, /Fields: description, name, owner, tags, targets/);

    result = runCli(workspaceDir, ["show", "skill", "skill.release-checklist", "--metadata"]);
    assert.equal(result.status, 0, result.stderr);
    const updatedMetadata = JSON.parse(result.stdout);
    assert.equal(updatedMetadata.name, "Release Checklist");
    assert.equal(updatedMetadata.description, "Release readiness checklist for Harness assets");
    assert.equal(updatedMetadata.owner, "team-platform");
    assert.deepEqual(updatedMetadata.tags, ["release", "readiness"]);
    assert.deepEqual(updatedMetadata.compatibility.targets, ["generic", "openai-codex"]);
    assert.equal(updatedMetadata.version, "1.0.0");
    assert.equal(updatedMetadata.history.length, 1);
    assert.equal(updatedMetadata.history[0].version, "1.0.0");

    result = runCli(workspaceDir, ["list", "--owner", "team-platform", "--tag", "release", "--target", "openai-codex", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const filteredAssets = JSON.parse(result.stdout);
    assert.equal(filteredAssets.assetCount, 1);
    assert.equal(filteredAssets.assets[0].id, "skill.release-checklist");
    assert.deepEqual(filteredAssets.assets[0].tags, ["release", "readiness"]);
    assert.match(filteredAssets.assets[0].compatibility.targets.join(","), /openai-codex/);

    result = runCli(workspaceDir, ["list", "--group-by", "target", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const groupedByTarget = JSON.parse(result.stdout);
    assert.equal(groupedByTarget.groupBy, "target");
    assert.equal(groupedByTarget.assetCount, 4);
    assert.equal(groupedByTarget.groups.length, 3);
    const targetCounts = Object.fromEntries(groupedByTarget.groups.map((group) => [group.key, group.assetCount]));
    assert.deepEqual(targetCounts, {
      "claude-code": 3,
      generic: 4,
      "openai-codex": 4
    });

    result = runCli(workspaceDir, ["bump-version", "skill", "skill.release-checklist", "1.1.0", "--note", "Expanded rollout checks"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Bumped skill\.release-checklist from 1\.0\.0 to 1\.1\.0/);

    result = runCli(workspaceDir, ["show", "skill", "skill.release-checklist", "1.0.0"]);
    assert.equal(result.status, 0, result.stderr);
    const snapshotAsset = JSON.parse(result.stdout);
    assert.equal(snapshotAsset.version, "1.0.0");
    assert.match(snapshotAsset.renderedContent, /Add skill content here\./);

    result = runCli(workspaceDir, ["diff", "skill", "skill.release-checklist", "1.0.0", "1.1.0"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Diff: skill\.release-checklist/);
    assert.match(result.stdout, /Range: 1\.0\.0 -> 1\.1\.0/);
    assert.match(result.stdout, /Summary: \d+ metadata fields changed; content unchanged/);
    assert.match(result.stdout, /Fields: compatibility, description, history, owner, tags, version/);
    assert.match(result.stdout, /Metadata \(\d+ additions, \d+ removals\)/);
    assert.match(result.stdout, /Content \(\d+ additions, \d+ removals\)/);
    assert.match(result.stdout, /Expanded rollout checks/);

    result = runCli(workspaceDir, ["diff", "skill", "skill.release-checklist", "1.0.0", "1.1.0", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const diffResult = JSON.parse(result.stdout);
    assert.equal(diffResult.id, "skill.release-checklist");
    assert.equal(diffResult.fromVersion, "1.0.0");
    assert.equal(diffResult.toVersion, "1.1.0");
    assert.equal(diffResult.hasContentChanges, false);
    assert.deepEqual(diffResult.metadataFieldsChanged, ["compatibility", "description", "history", "owner", "tags", "version"]);

    result = runCli(workspaceDir, ["export"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Target: generic/);

    result = runCli(workspaceDir, ["export", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const defaultExportResult = JSON.parse(result.stdout);
    assert.equal(defaultExportResult.target, "generic");
    assert.equal(defaultExportResult.assetCount, 4);
    assert.match(defaultExportResult.outputPath, /exports\/generic\.json/);

    result = runCli(workspaceDir, ["export", "generic", "--entry", "agent:agent.harness-manager", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const entryOnlyExportResult = JSON.parse(result.stdout);
    assert.equal(entryOnlyExportResult.target, "generic");
    assert.equal(entryOnlyExportResult.entry, "agent:agent.harness-manager");
    assert.equal(entryOnlyExportResult.includeDependencies, false);
    assert.equal(entryOnlyExportResult.assetCount, 1);

    let exported = readJson(path.join(workspaceDir, "exports", "generic.json"));
    assert.equal(exported.assets.length, 1);
    assert.equal(exported.assets[0].id, "agent.harness-manager");

    result = runCli(workspaceDir, ["export", "generic", "--entry", "agent:agent.harness-manager", "--include-dependencies", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const entryWithDependenciesExportResult = JSON.parse(result.stdout);
    assert.equal(entryWithDependenciesExportResult.target, "generic");
    assert.equal(entryWithDependenciesExportResult.entry, "agent:agent.harness-manager");
    assert.equal(entryWithDependenciesExportResult.includeDependencies, true);
    assert.equal(entryWithDependenciesExportResult.assetCount, 3);

    result = runCli(workspaceDir, ["export", "generic"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Export complete\./);
    assert.match(result.stdout, /Target: generic/);
    assert.match(result.stdout, /Assets: 4/);
    assert.match(result.stdout, /Output: .*exports\/generic\.json/);

    result = runCli(workspaceDir, ["pack", "generic", "--entry", "agent:agent.harness-manager", "--include-dependencies", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const packResult = JSON.parse(result.stdout);
    assert.equal(packResult.target, "generic");
    assert.equal(packResult.entry, "agent:agent.harness-manager");
    assert.equal(packResult.includeDependencies, true);
    assert.equal(packResult.assetCount, 3);
    assert.match(packResult.bundlePath, /releases\/agent\.harness-manager-generic/);
    assert.match(packResult.checksumsPath, /releases\/agent\.harness-manager-generic\/checksums\.json/);

    const manifest = readJson(packResult.manifestPath);
    assert.equal(manifest.target, "generic");
    assert.equal(manifest.channel, "draft");
    assert.equal(manifest.entryAsset.id, "agent.harness-manager");
    assert.equal(manifest.includeDependencies, true);
    assert.equal(manifest.includedAssets.length, 3);
    assert.equal(manifest.digest.algorithm, "sha256");
    assert.match(manifest.digest.files["assets.json"], /^[a-f0-9]{64}$/);
    assert.match(manifest.digest.files["rendered/generic.json"], /^[a-f0-9]{64}$/);

    const bundleAssets = readJson(packResult.assetsPath);
    assert.equal(bundleAssets.channel, "draft");
    assert.equal(bundleAssets.assets.length, 3);
    assert.equal(bundleAssets.assets[0].content !== undefined, true);

    const renderedBundle = readJson(packResult.renderedPath);
    assert.equal(renderedBundle.target, "generic");
    assert.equal(renderedBundle.assets.length, 3);

    const checksums = readJson(packResult.checksumsPath);
    assert.equal(checksums.algorithm, "sha256");
    assert.match(checksums.files["manifest.json"], /^[a-f0-9]{64}$/);
    assert.equal(checksums.files["assets.json"], manifest.digest.files["assets.json"]);
    assert.equal(checksums.files["rendered/generic.json"], manifest.digest.files["rendered/generic.json"]);

    result = runCli(workspaceDir, ["pack", "generic", "--entry", "agent:agent.harness-manager", "--include-dependencies", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const repeatedPackResult = JSON.parse(result.stdout);
    assert.deepEqual(readJson(repeatedPackResult.checksumsPath), checksums);

    result = runCli(workspaceDir, ["pack", "generic", "--entry", "agent:agent.harness-manager", "--channel", "stable", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const stablePackResult = JSON.parse(result.stdout);
    assert.equal(stablePackResult.channel, "stable");
    const stableManifest = readJson(stablePackResult.manifestPath);
    assert.equal(stableManifest.channel, "stable");

    result = runCli(workspaceDir, ["verify-bundle", packResult.bundlePath, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const verificationResult = JSON.parse(result.stdout);
    assert.equal(verificationResult.valid, true);
    assert.equal(verificationResult.issueCount, 0);
    assert.deepEqual(verificationResult.issues, []);

    const tamperedAssets = readJson(packResult.assetsPath);
    tamperedAssets.assets[0].version = "9.9.9";
    writeFileSync(packResult.assetsPath, `${JSON.stringify(tamperedAssets, null, 2)}\n`, "utf8");

    result = runCli(workspaceDir, ["verify-bundle", packResult.bundlePath, "--json"]);
    assert.equal(result.status, 1);
    const failedVerificationResult = JSON.parse(result.stdout);
    assert.equal(failedVerificationResult.valid, false);
    assert.ok(failedVerificationResult.issues.includes("Digest mismatch: assets.json"));
    assert.ok(failedVerificationResult.issues.includes("Manifest includedAssets do not match assets payload."));

    result = runCli(workspaceDir, ["pack", "generic", "--entry", "agent:agent.harness-manager", "--include-dependencies", "--archive", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const archivedPackResult = JSON.parse(result.stdout);
    assert.match(archivedPackResult.archivePath, /releases\/agent\.harness-manager-generic\.tar\.gz/);
    assert.equal(existsSync(archivedPackResult.archivePath), true);

    const extractedBundlePath = path.join(workspaceDir, "extracted-bundle");
    mkdirSync(extractedBundlePath, { recursive: true });
    extractTarGzip(archivedPackResult.archivePath, extractedBundlePath);
    result = runCli(workspaceDir, ["verify-bundle", extractedBundlePath, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const extractedVerificationResult = JSON.parse(result.stdout);
    assert.equal(extractedVerificationResult.valid, true);

    const exportPath = path.join(workspaceDir, "exports", "generic.json");
    assert.equal(existsSync(exportPath), true);
    exported = readJson(exportPath);
    assert.equal(exported.target, "generic");
    assert.equal(exported.assets.length, 4);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("show rejects mutually exclusive metadata and content flags", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["show", "skill", "skill.prompt-authoring", "--metadata", "--content"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Choose only one of --metadata, --content, or --resolved\./);

    result = runCli(workspaceDir, ["show", "skill", "skill.prompt-authoring", "--metadata", "--resolved"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Choose only one of --metadata, --content, or --resolved\./);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("list rejects unsupported kinds", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["list", "--kind", "workflow"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported asset kind: workflow/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("list rejects unsupported group-by values", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["list", "--group-by", "version"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported list group: version/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("list rejects unsupported status values", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["list", "--status", "retired"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported asset status: retired/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("set requires at least one metadata update", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["set", "skill", "skill.prompt-authoring"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No metadata updates provided/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("set rejects unsupported compatibility targets", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["set", "skill", "skill.prompt-authoring", "--targets", "generic,missing-target"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported compatibility target for skill\.prompt-authoring: missing-target/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("add-dependency updates dependency graphs and rejects duplicate dependencies", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, [
      "add-dependency",
      "skill",
      "skill.prompt-authoring",
      "instruction",
      "instruction.repository-guardrails",
      "--optional"
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Added dependency to \[skill\] skill\.prompt-authoring/);
    assert.match(result.stdout, /Dependency: instruction:instruction\.repository-guardrails \(optional\)/);
    assert.match(result.stdout, /Dependencies: 1/);

    result = runCli(workspaceDir, ["show", "skill", "skill.prompt-authoring", "--resolved"]);
    assert.equal(result.status, 0, result.stderr);
    const resolvedSkill = JSON.parse(result.stdout);
    assert.equal(resolvedSkill.summary.directDependencyCount, 1);
    assert.equal(resolvedSkill.summary.resolvedAssetCount, 2);
    assert.equal(resolvedSkill.resolvedDependencies[0].required, false);
    assert.equal(resolvedSkill.resolvedDependencies[0].asset.id, "instruction.repository-guardrails");

    result = runCli(workspaceDir, [
      "add-dependency",
      "skill",
      "skill.prompt-authoring",
      "instruction",
      "instruction.repository-guardrails"
    ]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Asset dependency already exists: skill\.prompt-authoring -> instruction:instruction\.repository-guardrails/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("add-dependency rejects missing dependencies and cycles", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["add-dependency", "skill", "skill.prompt-authoring", "instruction", "instruction.missing"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Dependency asset not found: instruction:instruction\.missing/);

    result = runCli(workspaceDir, ["add-dependency", "skill", "skill.prompt-authoring", "agent", "agent.harness-manager"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Dependency cycle would be created: skill\.prompt-authoring -> agent\.harness-manager -> skill\.prompt-authoring/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("remove-dependency updates dependency graphs and rejects missing edges", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["remove-dependency", "agent", "agent.harness-manager", "skill", "skill.prompt-authoring"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Removed dependency from \[agent\] agent\.harness-manager/);
    assert.match(result.stdout, /Dependency: skill:skill\.prompt-authoring/);
    assert.match(result.stdout, /Dependencies: 1/);

    result = runCli(workspaceDir, ["show", "agent", "agent.harness-manager", "--resolved"]);
    assert.equal(result.status, 0, result.stderr);
    const resolvedAgent = JSON.parse(result.stdout);
    assert.equal(resolvedAgent.summary.directDependencyCount, 1);
    assert.equal(resolvedAgent.summary.resolvedAssetCount, 2);
    assert.deepEqual(
      resolvedAgent.resolvedDependencies.map((dependency) => `${dependency.kind}:${dependency.id}`),
      ["instruction:instruction.repository-guardrails"]
    );

    result = runCli(workspaceDir, ["remove-dependency", "agent", "agent.harness-manager", "skill", "skill.prompt-authoring"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Asset dependency not found: agent\.harness-manager -> skill:skill\.prompt-authoring/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("clone creates a new asset with copied content, dependencies, and its own snapshot", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, [
      "init"
    ]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, [
      "clone",
      "agent",
      "agent.harness-manager",
      "agent.platform-manager",
      "--name",
      "Platform Manager",
      "--version",
      "0.2.0",
      "--note",
      "Created platform manager variant"
    ]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Cloned \[agent\] agent\.harness-manager -> agent\.platform-manager @ 0\.2\.0/);

    result = runCli(workspaceDir, ["show", "agent", "agent.platform-manager"]);
    assert.equal(result.status, 0, result.stderr);
    const clonedAgent = JSON.parse(result.stdout);
    assert.equal(clonedAgent.id, "agent.platform-manager");
    assert.equal(clonedAgent.name, "Platform Manager");
    assert.equal(clonedAgent.version, "0.2.0");
    assert.deepEqual(
      clonedAgent.dependencies.map((dependency) => `${dependency.kind}:${dependency.id}`),
      ["skill:skill.prompt-authoring", "instruction:instruction.repository-guardrails"]
    );
    assert.equal(clonedAgent.history.length, 1);
    assert.equal(clonedAgent.history[0].notes, "Created platform manager variant");
    assert.match(clonedAgent.renderedContent, /personal library of agent assets and workflow packages/);

    result = runCli(workspaceDir, ["show", "agent", "agent.platform-manager", "0.2.0"]);
    assert.equal(result.status, 0, result.stderr);
    const clonedSnapshot = JSON.parse(result.stdout);
    assert.equal(clonedSnapshot.id, "agent.platform-manager");
    assert.equal(clonedSnapshot.version, "0.2.0");

    result = runCli(workspaceDir, ["validate"]);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("clone rejects an existing target asset", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["clone", "skill", "skill.prompt-authoring", "skill.prompt-authoring"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Asset already exists: skill\.prompt-authoring/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("archive marks unused assets and supports status filtering", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["clone", "skill", "skill.prompt-authoring", "skill.prompt-authoring-copy"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["archive", "skill", "skill.prompt-authoring-copy", "--reason", "Folded into prompt-authoring"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Archived \[skill\] skill\.prompt-authoring-copy/);
    assert.match(result.stdout, /Status: archived/);
    assert.match(result.stdout, /Reason: Folded into prompt-authoring/);

    result = runCli(workspaceDir, ["show", "skill", "skill.prompt-authoring-copy", "--metadata"]);
    assert.equal(result.status, 0, result.stderr);
    const archivedAsset = JSON.parse(result.stdout);
    assert.equal(archivedAsset.status, "archived");
    assert.equal(archivedAsset.archive.reason, "Folded into prompt-authoring");

    result = runCli(workspaceDir, ["list", "--status", "archived", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const archivedList = JSON.parse(result.stdout);
    assert.equal(archivedList.assetCount, 1);
    assert.equal(archivedList.assets[0].id, "skill.prompt-authoring-copy");

    result = runCli(workspaceDir, ["validate"]);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("archive blocks assets that are still depended on", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["archive", "skill", "skill.prompt-authoring", "--reason", "No longer used"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Cannot archive skill\.prompt-authoring; it is still required by agent\.harness-manager\./);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("deps reports direct and recursive dependency graph details", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["deps", "agent", "agent.harness-manager"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Dependencies: agent\.harness-manager/);
    assert.match(result.stdout, /Direct: 2/);
    assert.match(result.stdout, /Resolved assets: 2/);
    assert.match(result.stdout, /Missing: 0/);
    assert.match(result.stdout, /Cycles: 0/);
    assert.match(result.stdout, /- skill:skill\.prompt-authoring \(required, resolved\)/);
    assert.match(result.stdout, /- instruction:instruction\.repository-guardrails \(required, resolved\)/);

    result = runCli(workspaceDir, ["deps", "agent", "agent.harness-manager", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const depsResult = JSON.parse(result.stdout);
    assert.equal(depsResult.id, "agent.harness-manager");
    assert.equal(depsResult.kind, "agent");
    assert.equal(depsResult.directDependencies.length, 2);
    assert.deepEqual(
      depsResult.directDependencies.map((dependency) => `${dependency.kind}:${dependency.id}:${dependency.status}`),
      [
        "skill:skill.prompt-authoring:resolved",
        "instruction:instruction.repository-guardrails:resolved"
      ]
    );
    assert.deepEqual(
      depsResult.resolvedAssets.map((asset) => asset.id).sort(),
      ["instruction.repository-guardrails", "skill.prompt-authoring"]
    );
    assert.deepEqual(depsResult.missing, []);
    assert.deepEqual(depsResult.cycles, []);
    assert.equal(depsResult.summary.resolvedAssetCount, 3);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("dependents reports direct and recursive upstream paths", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["clone", "agent", "agent.harness-manager", "agent.platform-manager"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, [
      "add-dependency",
      "agent",
      "agent.platform-manager",
      "agent",
      "agent.harness-manager"
    ]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["dependents", "skill", "skill.prompt-authoring"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Dependents: skill\.prompt-authoring/);
    assert.match(result.stdout, /Direct: 2/);
    assert.match(result.stdout, /Upstream assets: 2/);
    assert.match(result.stdout, /Paths: 3/);
    assert.match(result.stdout, /- agent\.harness-manager -> skill\.prompt-authoring/);
    assert.match(result.stdout, /- agent\.platform-manager -> skill\.prompt-authoring/);
    assert.match(result.stdout, /- agent\.platform-manager -> agent\.harness-manager -> skill\.prompt-authoring/);

    result = runCli(workspaceDir, ["dependents", "skill", "skill.prompt-authoring", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const dependentsResult = JSON.parse(result.stdout);
    assert.equal(dependentsResult.id, "skill.prompt-authoring");
    assert.deepEqual(
      dependentsResult.directDependents.map((asset) => asset.id),
      ["agent.harness-manager", "agent.platform-manager"]
    );
    assert.deepEqual(
      dependentsResult.upstreamAssets.map((asset) => asset.id),
      ["agent.harness-manager", "agent.platform-manager"]
    );
    assert.deepEqual(
      dependentsResult.paths.map((pathEntry) => pathEntry.assets),
      [
        ["agent.harness-manager", "skill.prompt-authoring"],
        ["agent.platform-manager", "agent.harness-manager", "skill.prompt-authoring"],
        ["agent.platform-manager", "skill.prompt-authoring"]
      ]
    );
    assert.equal(dependentsResult.summary.directDependentCount, 2);
    assert.equal(dependentsResult.summary.upstreamAssetCount, 2);
    assert.equal(dependentsResult.summary.pathCount, 3);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("orphans reports unreferenced non-entry assets with optional kind filtering", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["new", "skill", "skill.unused-checklist", "--description", "Unused checklist", "--owner", "team-harness"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["clone", "agent", "agent.harness-manager", "agent.unreferenced-manager"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["orphans"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Orphans: 1/);
    assert.match(result.stdout, /Entry kinds: agent/);
    assert.match(result.stdout, /- skill:skill\.unused-checklist @ 1\.0\.0/);
    assert.doesNotMatch(result.stdout, /agent\.unreferenced-manager/);

    result = runCli(workspaceDir, ["orphans", "--kind", "skill", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const orphanSkills = JSON.parse(result.stdout);
    assert.deepEqual(orphanSkills.entryKinds, ["agent"]);
    assert.equal(orphanSkills.filters.kind, "skill");
    assert.equal(orphanSkills.orphanCount, 1);
    assert.equal(orphanSkills.orphans[0].id, "skill.unused-checklist");

    result = runCli(workspaceDir, ["orphans", "--kind", "instruction", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const orphanInstructions = JSON.parse(result.stdout);
    assert.equal(orphanInstructions.orphanCount, 0);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("impact reports affected assets, entry agents, and suggested packs", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["clone", "agent", "agent.harness-manager", "agent.platform-manager"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["impact", "skill", "skill.prompt-authoring"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Impact: skill\.prompt-authoring/);
    assert.match(result.stdout, /Affected assets: 2/);
    assert.match(result.stdout, /Affected entry agents: 2/);
    assert.match(result.stdout, /Suggested packs: 2/);
    assert.match(result.stdout, /- agent:agent\.harness-manager/);
    assert.match(result.stdout, /- agent:agent\.platform-manager/);

    result = runCli(workspaceDir, ["impact", "skill", "skill.prompt-authoring", "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const impactResult = JSON.parse(result.stdout);
    assert.equal(impactResult.id, "skill.prompt-authoring");
    assert.deepEqual(
      impactResult.affectedAssets.map((asset) => asset.id),
      ["agent.harness-manager", "agent.platform-manager"]
    );
    assert.deepEqual(
      impactResult.affectedEntryAssets.map((asset) => asset.id),
      ["agent.harness-manager", "agent.platform-manager"]
    );
    assert.deepEqual(
      impactResult.suggestedPacks.map((pack) => pack.entry),
      ["agent:agent.harness-manager", "agent:agent.platform-manager"]
    );
    assert.equal(impactResult.summary.affectedAssetCount, 2);
    assert.equal(impactResult.summary.affectedEntryAssetCount, 2);
    assert.equal(impactResult.summary.suggestedPackCount, 2);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("init refuses to overwrite an existing workspace without --force", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /HarnessBrew workspace already exists/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("export uses workspace exportDirectory and validate accepts the configured path", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    const workspaceConfigPath = path.join(workspaceDir, ".harnessbrew", "workspace.json");
    const workspace = readJson(workspaceConfigPath);
    workspace.exportDirectory = "custom-exports/nested";
    writeFileSync(workspaceConfigPath, `${JSON.stringify(workspace, null, 2)}\n`, "utf8");

    result = runCli(workspaceDir, ["validate"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Workspace is valid/);

    result = runCli(workspaceDir, ["export", "generic"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Output: .*custom-exports\/nested\/generic\.json/);

    const exportPath = path.join(workspaceDir, "custom-exports", "nested", "generic.json");
    assert.equal(existsSync(exportPath), true);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("workspace can load a local adapter module and export with the custom target", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    const adaptersDir = path.join(workspaceDir, "adapters");
    mkdirSync(adaptersDir, { recursive: true });
    writeFileSync(
      path.join(adaptersDir, "json-lines.js"),
      `export default {
  target: "json-lines",
  render(workspace, assets) {
    return assets.map((asset) => ({
      target: "json-lines",
      workspace: workspace.name,
      id: asset.id,
      kind: asset.kind,
      version: asset.version
    }));
  }
};
`,
      "utf8"
    );

    const workspaceConfigPath = path.join(workspaceDir, ".harnessbrew", "workspace.json");
    const workspace = readJson(workspaceConfigPath);
    workspace.adapterModules = ["adapters/json-lines.js"];
    workspace.supportedTargets.push("json-lines");
    writeFileSync(workspaceConfigPath, `${JSON.stringify(workspace, null, 2)}\n`, "utf8");

    for (const assetLocation of [
      ["agents", "agent.harness-manager"],
      ["skills", "skill.prompt-authoring"],
      ["instructions", "instruction.repository-guardrails"]
    ]) {
      const assetPath = path.join(workspaceDir, "assets", assetLocation[0], assetLocation[1], "asset.json");
      const asset = readJson(assetPath);
      asset.compatibility.targets.push("json-lines");
      writeFileSync(assetPath, `${JSON.stringify(asset, null, 2)}\n`, "utf8");
    }

    result = runCli(workspaceDir, ["targets"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /- json-lines \[.*adapters\/json-lines\.js\]/);

    result = runCli(workspaceDir, ["validate"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["export", "json-lines"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Target: json-lines/);

    const exportPath = path.join(workspaceDir, "exports", "json-lines.json");
    assert.equal(existsSync(exportPath), true);
    const exported = readJson(exportPath);
    assert.equal(Array.isArray(exported), true);
    assert.equal(exported[0].target, "json-lines");
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("validate catches broken history and snapshot consistency", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    const assetPath = path.join(workspaceDir, "assets", "skills", "skill.prompt-authoring", "asset.json");
    const asset = readJson(assetPath);
    asset.version = "1.1.0";
    asset.compatibility.targets.push("generic");
    asset.history.push({
      version: "1.0.0",
      date: "2026-06-06",
      notes: "Duplicate version entry.",
      snapshot: ".snapshots/not-the-version"
    });
    writeFileSync(assetPath, `${JSON.stringify(asset, null, 2)}\n`, "utf8");

    result = runCli(workspaceDir, ["validate"]);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /Workspace validation failed\./);
    assert.match(result.stdout, /Asset current version must match latest history entry: skill\.prompt-authoring -> 1\.1\.0/);
    assert.match(result.stdout, /Asset compatibility\.targets contains duplicates: skill\.prompt-authoring -> generic/);
    assert.match(result.stdout, /History entry version must be unique: skill\.prompt-authoring -> 1\.0\.0/);
    assert.match(result.stdout, /History entry snapshot path must match version: skill\.prompt-authoring -> 1\.0\.0/);

    result = runCli(workspaceDir, ["validate", "--json"]);
    assert.equal(result.status, 1);
    const failedValidationResult = JSON.parse(result.stdout);
    assert.equal(failedValidationResult.valid, false);
    assert.ok(failedValidationResult.issueCount >= 4);
    assert.ok(
      failedValidationResult.issues.includes("Asset current version must match latest history entry: skill.prompt-authoring -> 1.1.0")
    );
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("validate catches broken dependency definitions", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    const agentPath = path.join(workspaceDir, "assets", "agents", "agent.harness-manager", "asset.json");
    const skillPath = path.join(workspaceDir, "assets", "skills", "skill.prompt-authoring", "asset.json");

    const agent = readJson(agentPath);
    const skill = readJson(skillPath);

    agent.dependencies = [
      { kind: "skill", id: "skill.prompt-authoring", required: true },
      { kind: "skill", id: "skill.prompt-authoring", required: true },
      { kind: "instruction", id: "instruction.missing-guardrails", required: true }
    ];
    agent.compatibility.targets = ["generic", "openai-codex", "claude-code"];

    skill.compatibility.targets = ["generic"];
    skill.dependencies = [{ kind: "agent", id: "agent.harness-manager", required: true }];

    writeFileSync(agentPath, `${JSON.stringify(agent, null, 2)}\n`, "utf8");
    writeFileSync(skillPath, `${JSON.stringify(skill, null, 2)}\n`, "utf8");

    result = runCli(workspaceDir, ["validate", "--json"]);
    assert.equal(result.status, 1);
    const failedValidationResult = JSON.parse(result.stdout);
    assert.equal(failedValidationResult.valid, false);
    assert.ok(
      failedValidationResult.issues.includes(
        "Asset dependencies contain duplicates: agent.harness-manager -> skill:skill.prompt-authoring"
      )
    );
    assert.ok(
      failedValidationResult.issues.includes(
        "Asset dependency is missing: agent.harness-manager -> instruction:instruction.missing-guardrails"
      )
    );
    assert.ok(
      failedValidationResult.issues.includes(
        "Asset dependency target mismatch: agent.harness-manager -> skill:skill.prompt-authoring missing target openai-codex"
      )
    );
    assert.ok(
      failedValidationResult.issues.includes(
        "Asset dependency cycle detected: agent.harness-manager -> skill.prompt-authoring -> agent.harness-manager"
      )
    );
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("history fails clearly for missing arguments", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    const result = runCli(workspaceDir, ["history", "skill"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage: harnessbrew history <kind> <id>/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("export rejects invalid entry values", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["export", "generic", "--entry", "workflow:foo"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid --entry value: workflow:foo/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("pack requires an entry asset", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    result = runCli(workspaceDir, ["pack", "generic"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Pack requires --entry <kind:id>/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

test("stable pack requires a valid workspace", () => {
  const workspaceDir = createWorkspaceDir();

  try {
    let result = runCli(workspaceDir, ["init"]);
    assert.equal(result.status, 0, result.stderr);

    const workspaceConfigPath = path.join(workspaceDir, ".harnessbrew", "workspace.json");
    const workspace = readJson(workspaceConfigPath);
    workspace.version = "not-semver";
    writeFileSync(workspaceConfigPath, `${JSON.stringify(workspace, null, 2)}\n`, "utf8");

    result = runCli(workspaceDir, ["pack", "generic", "--entry", "agent:agent.harness-manager", "--channel", "stable"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Stable pack requires a valid workspace: Workspace version must be semver: not-semver/);
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});
