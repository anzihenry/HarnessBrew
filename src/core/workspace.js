import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import path from "node:path";
import {
  assetsRoot,
  assetKindMap,
  exportsRoot,
  resolveExportDirectory,
  resolveAssetDirectory,
  resolveAssetPath,
  resolveSnapshotDirectory,
  workspaceConfigPath
} from "./paths.js";
import { readJson, stableStringify, writeJson } from "../utils/json.js";
import { listAdapterTargets, renderForTarget } from "./adapters.js";
import { createJsonDiff, createTextDiff } from "../utils/diff.js";

const defaultWorkspace = {
  name: "HarnessBrew",
  version: "0.1.1",
  schemaVersion: "1",
  timezone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  defaultTarget: "generic",
  supportedTargets: ["generic", "openai-codex", "claude-code"],
  exportDirectory: "exports",
  bundleDirectory: "releases",
  adapterModules: []
};

const sampleAssets = [
  {
    kind: "agent",
    id: "agent.harness-manager",
    metadata: {
      id: "agent.harness-manager",
      name: "HarnessBrew Manager",
      kind: "agent",
      version: "0.1.0",
      description: "Coordinates a personal asset library and workflow packages across agent ecosystems.",
      status: "active",
      tags: ["manager", "governance"],
      owner: "team-harness",
      compatibility: {
        targets: ["generic", "openai-codex", "claude-code"]
      },
      dependencies: [
        {
          kind: "skill",
          id: "skill.prompt-authoring",
          required: true
        },
        {
          kind: "instruction",
          id: "instruction.repository-guardrails",
          required: true
        }
      ],
      content: {
        entry: "content.md"
      },
      history: [
        {
          version: "0.1.0",
          date: "2026-06-06",
          notes: "Initial asset definition.",
          snapshot: ".snapshots/0.1.0"
        }
      ]
    },
    content: `# HarnessBrew Manager

You manage a personal library of agent assets and workflow packages across multiple runtime targets.

Responsibilities:
- keep agents, skills, and instructions organized
- maintain version metadata for each asset
- export normalized assets into target-specific formats
`
  },
  {
    kind: "skill",
    id: "skill.prompt-authoring",
    metadata: {
      id: "skill.prompt-authoring",
      name: "Prompt Authoring",
      kind: "skill",
      version: "1.0.0",
      description: "Reusable guidance for writing stable prompts.",
      status: "active",
      tags: ["prompt", "quality"],
      owner: "team-harness",
      compatibility: {
        targets: ["generic", "openai-codex", "claude-code"]
      },
      content: {
        entry: "content.md"
      },
      history: [
        {
          version: "1.0.0",
          date: "2026-06-06",
          notes: "Initial skill content.",
          snapshot: ".snapshots/1.0.0"
        }
      ]
    },
    content: `# Prompt Authoring

Write prompts that are:

- explicit about goals
- clear about tool boundaries
- stable under iteration
- easy to adapt for different agent runtimes
`
  },
  {
    kind: "instruction",
    id: "instruction.repository-guardrails",
    metadata: {
      id: "instruction.repository-guardrails",
      name: "Repository Guardrails",
      kind: "instruction",
      version: "1.0.0",
      description: "Operational rules for safe repository changes.",
      status: "active",
      tags: ["repo", "safety"],
      owner: "team-harness",
      compatibility: {
        targets: ["generic", "openai-codex", "claude-code"]
      },
      content: {
        entry: "content.md"
      },
      history: [
        {
          version: "1.0.0",
          date: "2026-06-06",
          notes: "Initial instruction content.",
          snapshot: ".snapshots/1.0.0"
        }
      ]
    },
    content: `# Repository Guardrails

- inspect the workspace before editing
- avoid destructive operations unless requested
- keep changes reviewable and well explained
`
  }
];

const assetIdSegmentPattern = "[a-z0-9]+(?:-[a-z0-9]+)*";
const supportedAssetStatuses = ["active", "archived"];
const supportedBundleChannels = ["draft", "stable"];

function currentDate() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return `${year}-${month}-${day}`;
}

function defaultVersionForKind(kind) {
  return kind === "agent" ? "0.1.0" : "1.0.0";
}

function titleFromId(assetId) {
  return assetId
    .split(".")
    .slice(1)
    .join(" ")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function parseTags(tags) {
  if (!tags) {
    return [];
  }

  return tags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function isSemver(version) {
  return /^\d+\.\d+\.\d+$/.test(version);
}

function compareSemver(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const delta = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isBoolean(value) {
  return typeof value === "boolean";
}

function isSafeRelativePath(filePath) {
  if (!isNonEmptyString(filePath)) {
    return false;
  }

  const normalized = path.posix.normalize(filePath.replaceAll("\\", "/"));
  return !normalized.startsWith("/") && normalized !== ".." && !normalized.startsWith("../");
}

function isSupportedKind(kind) {
  return Object.hasOwn(assetKindMap, kind);
}

function isValidAssetId(kind, assetId) {
  if (!isSupportedKind(kind) || typeof assetId !== "string") {
    return false;
  }

  const pattern = new RegExp(`^${kind}\\.${assetIdSegmentPattern}(?:\\.${assetIdSegmentPattern})*$`);
  return pattern.test(assetId);
}

function assertSupportedKind(kind) {
  if (!isSupportedKind(kind)) {
    const supportedKinds = Object.keys(assetKindMap).join(", ");
    throw new Error(`Unsupported asset kind: ${kind}. Supported kinds: ${supportedKinds}`);
  }
}

function assertValidAssetId(kind, assetId) {
  if (!isValidAssetId(kind, assetId)) {
    throw new Error(
      `Invalid asset id: ${assetId}. Expected format: ${kind}.name using lowercase letters, numbers, hyphens, and optional dot-separated segments.`
    );
  }
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function saveAssetFiles(kind, assetId, metadata, content) {
  const assetDir = resolveAssetPath(kind, assetId);
  await mkdir(assetDir, { recursive: true });
  await writeJson(path.join(assetDir, "asset.json"), metadata);
  await writeFile(path.join(assetDir, metadata.content.entry), content, "utf8");
}

async function writeSnapshot(kind, assetId, version, metadata, content) {
  const snapshotDir = path.join(resolveSnapshotDirectory(kind, assetId), version);
  const snapshotMetadata = {
    ...metadata,
    renderedContent: undefined
  };

  delete snapshotMetadata.renderedContent;

  await writeJson(path.join(snapshotDir, "asset.json"), snapshotMetadata);
  await writeFile(path.join(snapshotDir, metadata.content.entry), content, "utf8");
}

function getWorkspaceExportDirectory(workspace) {
  return resolveExportDirectory(workspace.exportDirectory || "exports");
}

function getWorkspaceBundleDirectory(workspace) {
  return resolveExportDirectory(workspace.bundleDirectory || "releases");
}

function currentTimestamp() {
  return new Date().toISOString();
}

function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function digestJson(data) {
  return sha256(stableStringify(data));
}

function normalizeManifestForDigest(manifest) {
  return {
    ...manifest,
    generatedAt: "<excluded-from-digest>"
  };
}

function tarOctal(value, length) {
  const octal = value.toString(8);
  return `${"0".repeat(Math.max(length - octal.length - 1, 0))}${octal}\0`;
}

function createTarHeader(name, size) {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, "utf8");
  header.write(tarOctal(0o644, 8), 100, 8, "ascii");
  header.write(tarOctal(0, 8), 108, 8, "ascii");
  header.write(tarOctal(0, 8), 116, 8, "ascii");
  header.write(tarOctal(size, 12), 124, 12, "ascii");
  header.write(tarOctal(0, 12), 136, 12, "ascii");
  header.fill(" ", 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  header.write(tarOctal(checksum, 8), 148, 8, "ascii");
  return header;
}

function createTarGzip(entries) {
  const blocks = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.content, "utf8");
    blocks.push(createTarHeader(entry.name, data.length));
    blocks.push(data);
    const padding = (512 - (data.length % 512)) % 512;
    if (padding > 0) {
      blocks.push(Buffer.alloc(padding, 0));
    }
  }

  blocks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(blocks), {
    mtime: 0
  });
}

export async function initWorkspace(options = {}) {
  if (!options.force && (await pathExists(workspaceConfigPath))) {
    throw new Error("HarnessBrew workspace already exists. Re-run with --force to overwrite the current workspace.");
  }

  await mkdir(path.dirname(workspaceConfigPath), { recursive: true });
  await writeJson(workspaceConfigPath, defaultWorkspace);

  for (const folder of Object.values(assetKindMap)) {
    await mkdir(path.join(assetsRoot, folder), { recursive: true });
  }

  await mkdir(exportsRoot, { recursive: true });

  for (const asset of sampleAssets) {
    await saveAssetFiles(asset.kind, asset.id, asset.metadata, asset.content);
    await writeSnapshot(asset.kind, asset.id, asset.metadata.version, asset.metadata, asset.content);
  }

  return {
    workspace: workspaceConfigPath,
    assetCount: sampleAssets.length
  };
}

export async function loadWorkspace() {
  return readJson(workspaceConfigPath);
}

async function loadAsset(kind, assetId) {
  const assetDir = resolveAssetPath(kind, assetId);
  const metadata = await readJson(path.join(assetDir, "asset.json"));
  const contentPath = path.join(assetDir, metadata.content.entry);
  const renderedContent = await readFile(contentPath, "utf8");

  return {
    ...metadata,
    dependencies: Array.isArray(metadata.dependencies) ? metadata.dependencies : [],
    renderedContent
  };
}

function matchesAssetFilters(asset, filters = {}) {
  if (filters.kind && asset.kind !== filters.kind) {
    return false;
  }

  if (filters.tag && !asset.tags.includes(filters.tag)) {
    return false;
  }

  if (filters.owner && asset.owner !== filters.owner) {
    return false;
  }

  if (filters.status && (asset.status || "active") !== filters.status) {
    return false;
  }

  if (filters.target && !asset.compatibility?.targets?.includes(filters.target)) {
    return false;
  }

  return true;
}

export async function listAssets(filters = {}) {
  const assets = [];

  for (const kind of Object.keys(assetKindMap)) {
    const dir = resolveAssetDirectory(kind);
    let entries = [];

    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const asset = await loadAsset(kind, entry.name);
      if (matchesAssetFilters(asset, filters)) {
        assets.push(asset);
      }
    }
  }

  return assets.sort((left, right) => left.id.localeCompare(right.id));
}

export async function showAsset(kind, assetId) {
  assertSupportedKind(kind);
  assertValidAssetId(kind, assetId);
  return loadAsset(kind, assetId);
}

function summarizeResolvedAsset(asset) {
  const summary = { ...asset };
  delete summary.renderedContent;
  return summary;
}

function toBundleAsset(asset) {
  const summary = summarizeResolvedAsset(asset);
  return {
    ...summary,
    content: asset.renderedContent
  };
}

export async function createAsset(kind, assetId, options = {}) {
  assertSupportedKind(kind);
  assertValidAssetId(kind, assetId);
  const workspace = await loadWorkspace();
  const assetDir = resolveAssetPath(kind, assetId);

  if (await pathExists(assetDir)) {
    throw new Error(`Asset already exists: ${assetId}`);
  }

  const version = options.version || defaultVersionForKind(kind);
  if (!isSemver(version)) {
    throw new Error(`Invalid version: ${version}`);
  }

  const targets = options.targets ? options.targets.split(",").map((item) => item.trim()).filter(Boolean) : workspace.supportedTargets;
  for (const target of targets) {
    if (!workspace.supportedTargets.includes(target)) {
      throw new Error(`Unsupported compatibility target for ${assetId}: ${target}`);
    }
  }

  const tags = parseTags(options.tags);
  const metadata = {
    id: assetId,
    name: options.name || titleFromId(assetId),
    kind,
    version,
    description: options.description || "",
    status: "active",
    tags,
    owner: options.owner || "unknown",
    compatibility: {
      targets
    },
    dependencies: [],
    content: {
      entry: "content.md"
    },
    history: [
      {
        version,
        date: currentDate(),
        notes: options.note || "Initial version.",
        snapshot: `/.snapshots/${version}`.slice(1)
      }
    ]
  };
  const content = options.content || `# ${metadata.name}\n\nAdd ${kind} content here.\n`;

  await saveAssetFiles(kind, assetId, metadata, content);
  await writeSnapshot(kind, assetId, version, metadata, content);

  return {
    kind,
    id: assetId,
    version
  };
}

export async function cloneAsset(kind, sourceId, targetId, options = {}) {
  assertSupportedKind(kind);
  assertValidAssetId(kind, sourceId);
  assertValidAssetId(kind, targetId);

  const targetDir = resolveAssetPath(kind, targetId);
  if (await pathExists(targetDir)) {
    throw new Error(`Asset already exists: ${targetId}`);
  }

  const sourceAsset = await loadAsset(kind, sourceId);
  const version = options.version || sourceAsset.version;
  if (!isSemver(version)) {
    throw new Error(`Invalid version: ${version}`);
  }

  const metadata = {
    ...stripRenderedContent(sourceAsset),
    id: targetId,
    name: options.name || titleFromId(targetId),
    version,
    status: "active",
    history: [
      {
        version,
        date: currentDate(),
        notes: options.note || `Cloned from ${sourceId}.`,
        snapshot: `/.snapshots/${version}`.slice(1)
      }
    ]
  };

  await saveAssetFiles(kind, targetId, metadata, sourceAsset.renderedContent);
  await writeSnapshot(kind, targetId, version, metadata, sourceAsset.renderedContent);

  return {
    kind,
    sourceId,
    id: targetId,
    version
  };
}

export async function updateAssetMetadata(kind, assetId, options = {}) {
  assertSupportedKind(kind);
  assertValidAssetId(kind, assetId);

  const editableFields = ["name", "description", "owner", "tags", "targets"];
  const requestedFields = editableFields.filter((field) => options[field] !== undefined);
  if (requestedFields.length === 0) {
    throw new Error("No metadata updates provided. Use at least one of --name, --description, --owner, --tags, or --targets.");
  }

  const workspace = await loadWorkspace();
  const asset = await loadAsset(kind, assetId);
  const updatedMetadata = stripRenderedContent(asset);

  for (const field of ["name", "description", "owner"]) {
    if (options[field] !== undefined) {
      if (!isNonEmptyString(options[field])) {
        throw new Error(`Asset ${field} must be a non-empty string.`);
      }

      updatedMetadata[field] = options[field];
    }
  }

  if (options.tags !== undefined) {
    updatedMetadata.tags = parseTags(options.tags);
  }

  if (options.targets !== undefined) {
    const targets = options.targets
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (targets.length === 0) {
      throw new Error("Asset targets must include at least one target.");
    }

    const seenTargets = new Set();
    for (const target of targets) {
      if (seenTargets.has(target)) {
        throw new Error(`Asset targets contain duplicates: ${target}`);
      }

      if (!workspace.supportedTargets.includes(target)) {
        throw new Error(`Unsupported compatibility target for ${assetId}: ${target}`);
      }

      seenTargets.add(target);
    }

    updatedMetadata.compatibility = {
      ...updatedMetadata.compatibility,
      targets
    };
  }

  await saveAssetFiles(kind, assetId, updatedMetadata, asset.renderedContent);

  return {
    kind,
    id: assetId,
    updatedFields: requestedFields.sort((left, right) => left.localeCompare(right)),
    version: updatedMetadata.version
  };
}

export async function addAssetDependency(kind, assetId, dependencyKind, dependencyId, options = {}) {
  assertSupportedKind(kind);
  assertValidAssetId(kind, assetId);
  assertSupportedKind(dependencyKind);
  assertValidAssetId(dependencyKind, dependencyId);

  const assets = await listAssets();
  const assetMap = createAssetMap(assets);
  const asset = assetMap.get(assetId);
  if (!asset) {
    throw new Error(`Asset not found: ${kind}:${assetId}`);
  }

  const dependencyAsset = assetMap.get(dependencyId);
  if (!dependencyAsset) {
    throw new Error(`Dependency asset not found: ${dependencyKind}:${dependencyId}`);
  }

  const existingDependencies = asset.dependencies || [];
  const dependencyExists = existingDependencies.some((dependency) => dependency.kind === dependencyKind && dependency.id === dependencyId);
  if (dependencyExists) {
    throw new Error(`Asset dependency already exists: ${assetId} -> ${dependencyKind}:${dependencyId}`);
  }

  for (const target of asset.compatibility?.targets || []) {
    if (!dependencyAsset.compatibility?.targets?.includes(target)) {
      throw new Error(`Dependency ${dependencyId} is missing required target ${target} for ${assetId}`);
    }
  }

  const nextDependency = {
    kind: dependencyKind,
    id: dependencyId,
    required: options.optional === "true" ? false : true
  };
  const updatedMetadata = {
    ...stripRenderedContent(asset),
    dependencies: [...existingDependencies, nextDependency].sort((left, right) => dependencyKey(left).localeCompare(dependencyKey(right)))
  };
  const updatedAsset = {
    ...updatedMetadata,
    renderedContent: asset.renderedContent
  };
  const nextAssetMap = new Map(assetMap);
  nextAssetMap.set(assetId, updatedAsset);
  const selection = resolveAssetSelection(updatedAsset, nextAssetMap, { includeDependencies: true });
  if (selection.cycles.length > 0) {
    throw new Error(`Dependency cycle would be created: ${selection.cycles[0].join(" -> ")}`);
  }

  await saveAssetFiles(kind, assetId, updatedMetadata, asset.renderedContent);

  return {
    kind,
    id: assetId,
    dependency: nextDependency,
    dependencyCount: updatedMetadata.dependencies.length
  };
}

export async function removeAssetDependency(kind, assetId, dependencyKind, dependencyId) {
  assertSupportedKind(kind);
  assertValidAssetId(kind, assetId);
  assertSupportedKind(dependencyKind);
  assertValidAssetId(dependencyKind, dependencyId);

  const asset = await loadAsset(kind, assetId);
  const existingDependencies = asset.dependencies || [];
  const nextDependencies = existingDependencies.filter((dependency) => dependency.kind !== dependencyKind || dependency.id !== dependencyId);

  if (nextDependencies.length === existingDependencies.length) {
    throw new Error(`Asset dependency not found: ${assetId} -> ${dependencyKind}:${dependencyId}`);
  }

  const updatedMetadata = {
    ...stripRenderedContent(asset),
    dependencies: nextDependencies
  };

  await saveAssetFiles(kind, assetId, updatedMetadata, asset.renderedContent);

  return {
    kind,
    id: assetId,
    dependency: {
      kind: dependencyKind,
      id: dependencyId
    },
    dependencyCount: nextDependencies.length
  };
}

export async function archiveAsset(kind, assetId, options = {}) {
  assertSupportedKind(kind);
  assertValidAssetId(kind, assetId);

  const asset = await loadAsset(kind, assetId);
  if ((asset.status || "active") === "archived") {
    throw new Error(`Asset is already archived: ${assetId}`);
  }

  const assets = await listAssets();
  const blockingDependent = assets.find((candidate) =>
    (candidate.dependencies || []).some((dependency) => dependency.kind === kind && dependency.id === assetId)
  );
  if (blockingDependent) {
    throw new Error(`Cannot archive ${assetId}; it is still required by ${blockingDependent.id}.`);
  }

  const updatedMetadata = {
    ...stripRenderedContent(asset),
    status: "archived",
    archive: {
      date: currentDate(),
      reason: options.reason || "Archived by HarnessBrew."
    }
  };

  await saveAssetFiles(kind, assetId, updatedMetadata, asset.renderedContent);

  return {
    kind,
    id: assetId,
    status: updatedMetadata.status,
    reason: updatedMetadata.archive.reason
  };
}

export async function bumpAssetVersion(kind, assetId, nextVersion, options = {}) {
  assertSupportedKind(kind);
  assertValidAssetId(kind, assetId);
  if (!isSemver(nextVersion)) {
    throw new Error(`Invalid version: ${nextVersion}`);
  }

  const asset = await loadAsset(kind, assetId);
  if (asset.version === nextVersion) {
    throw new Error(`Asset ${assetId} is already at version ${nextVersion}`);
  }

  if (asset.history.some((entry) => entry.version === nextVersion)) {
    throw new Error(`Version ${nextVersion} already exists in asset history`);
  }

  const updatedMetadata = {
    ...asset,
    version: nextVersion,
    history: [
      ...asset.history,
      {
        version: nextVersion,
        date: currentDate(),
        notes: options.note || `Bumped from ${asset.version} to ${nextVersion}.`,
        snapshot: `/.snapshots/${nextVersion}`.slice(1)
      }
    ]
  };

  delete updatedMetadata.renderedContent;

  await saveAssetFiles(kind, assetId, updatedMetadata, asset.renderedContent);
  await writeSnapshot(kind, assetId, nextVersion, updatedMetadata, asset.renderedContent);

  return {
    id: assetId,
    previousVersion: asset.version,
    nextVersion
  };
}

async function loadSnapshot(kind, assetId, version) {
  const snapshotDir = path.join(resolveSnapshotDirectory(kind, assetId), version);
  const metadata = await readJson(path.join(snapshotDir, "asset.json"));
  const contentPath = path.join(snapshotDir, metadata.content.entry);
  const renderedContent = await readFile(contentPath, "utf8");

  return {
    ...metadata,
    dependencies: Array.isArray(metadata.dependencies) ? metadata.dependencies : [],
    renderedContent
  };
}

function dependencyKey(dependency) {
  return `${dependency.kind}:${dependency.id}`;
}

function createAssetMap(assets) {
  return new Map(assets.map((asset) => [asset.id, asset]));
}

function resolveAssetSelection(rootAsset, assetMap, options = {}) {
  const includeDependencies = options.includeDependencies === true;
  const selectedAssets = new Map([[rootAsset.id, rootAsset]]);
  const missing = [];
  const cycles = [];
  const visiting = new Set();
  const visited = new Set();

  function walk(asset, stack = []) {
    if (!includeDependencies) {
      return;
    }

    visiting.add(asset.id);
    for (const dependency of asset.dependencies || []) {
      if (stack.includes(dependency.id) || visiting.has(dependency.id)) {
        cycles.push([...stack, asset.id, dependency.id]);
        continue;
      }

      const dependencyAsset = assetMap.get(dependency.id);
      if (!dependencyAsset) {
        missing.push({
          from: asset.id,
          kind: dependency.kind,
          id: dependency.id,
          required: dependency.required ?? true
        });
        continue;
      }

      selectedAssets.set(dependencyAsset.id, dependencyAsset);
      if (visited.has(dependencyAsset.id)) {
        continue;
      }

      walk(dependencyAsset, [...stack, asset.id]);
    }

    visiting.delete(asset.id);
    visited.add(asset.id);
  }

  walk(rootAsset);

  return {
    assets: [...selectedAssets.values()].sort((left, right) => left.id.localeCompare(right.id)),
    missing,
    cycles
  };
}

function selectExportAssets(allAssets, resolvedTarget, entry, includeDependencies) {
  const assetMap = createAssetMap(allAssets);
  let exportAssets = allAssets;

  if (entry) {
    assertSupportedKind(entry.kind);
    assertValidAssetId(entry.kind, entry.id);

    const rootAsset = assetMap.get(entry.id);
    if (!rootAsset) {
      throw new Error(`Entry asset not found: ${entry.kind}:${entry.id}`);
    }

    const selection = resolveAssetSelection(rootAsset, assetMap, { includeDependencies });
    if (selection.missing.length > 0) {
      const firstMissing = selection.missing[0];
      throw new Error(`Missing dependency for export: ${firstMissing.from} -> ${firstMissing.kind}:${firstMissing.id}`);
    }

    if (selection.cycles.length > 0) {
      throw new Error(`Dependency cycle blocks export: ${selection.cycles[0].join(" -> ")}`);
    }

    exportAssets = selection.assets;
  }

  for (const asset of exportAssets) {
    if (!asset.compatibility?.targets?.includes(resolvedTarget)) {
      throw new Error(`Asset is not compatible with target ${resolvedTarget}: ${asset.id}`);
    }
  }

  return exportAssets;
}

function validateAssetDependencies(asset, assetMap, issues, cycleIssues) {
  if (asset.dependencies === undefined) {
    return;
  }

  if (!Array.isArray(asset.dependencies)) {
    issues.push(`Asset dependencies must be an array: ${asset.id}`);
    return;
  }

  const seenDependencies = new Set();
  for (const dependency of asset.dependencies) {
    if (!dependency || typeof dependency !== "object") {
      issues.push(`Asset dependency must be an object: ${asset.id}`);
      continue;
    }

    const { kind, id, required = true } = dependency;
    if (!isSupportedKind(kind)) {
      issues.push(`Asset dependency kind is unsupported: ${asset.id} -> ${kind}`);
      continue;
    }

    if (!isValidAssetId(kind, id)) {
      issues.push(`Asset dependency id format is invalid: ${asset.id} -> ${id}`);
      continue;
    }

    if (dependency.required !== undefined && !isBoolean(required)) {
      issues.push(`Asset dependency required flag must be boolean: ${asset.id} -> ${dependencyKey(dependency)}`);
    }

    const key = dependencyKey({ kind, id });
    if (seenDependencies.has(key)) {
      issues.push(`Asset dependencies contain duplicates: ${asset.id} -> ${key}`);
      continue;
    }
    seenDependencies.add(key);

    const dependencyAsset = assetMap.get(id);
    if (!dependencyAsset) {
      issues.push(`Asset dependency is missing: ${asset.id} -> ${key}`);
      continue;
    }

    for (const target of asset.compatibility?.targets || []) {
      if (!dependencyAsset.compatibility?.targets?.includes(target)) {
        issues.push(`Asset dependency target mismatch: ${asset.id} -> ${key} missing target ${target}`);
      }
    }
  }

  const visitState = new Map();
  const visitStack = [];

  function visit(assetId) {
    const currentState = visitState.get(assetId);
    if (currentState === "done") {
      return;
    }

    if (currentState === "visiting") {
      const cycleStartIndex = visitStack.indexOf(assetId);
      const cyclePath = [...visitStack.slice(cycleStartIndex), assetId].join(" -> ");
      cycleIssues.add(`Asset dependency cycle detected: ${cyclePath}`);
      return;
    }

    visitState.set(assetId, "visiting");
    visitStack.push(assetId);

    const currentAsset = assetMap.get(assetId);
    for (const dependency of currentAsset?.dependencies || []) {
      if (!assetMap.has(dependency.id)) {
        continue;
      }

      visit(dependency.id);
    }

    visitStack.pop();
    visitState.set(assetId, "done");
  }

  visit(asset.id);
}

function stripRenderedContent(asset) {
  const normalized = { ...asset };
  delete normalized.renderedContent;
  return normalized;
}

function summarizeMetadataFieldChanges(left, right) {
  const changedFields = [];
  const fieldNames = new Set([...Object.keys(left), ...Object.keys(right)]);

  for (const fieldName of fieldNames) {
    if (stableStringify(left[fieldName]) !== stableStringify(right[fieldName])) {
      changedFields.push(fieldName);
    }
  }

  return changedFields.sort((a, b) => a.localeCompare(b));
}

export async function showAssetVersion(kind, assetId, version) {
  assertSupportedKind(kind);
  assertValidAssetId(kind, assetId);
  return loadSnapshot(kind, assetId, version);
}

export async function showResolvedAsset(kind, assetId, version) {
  assertSupportedKind(kind);
  assertValidAssetId(kind, assetId);

  const rootAsset = version ? await loadSnapshot(kind, assetId, version) : await loadAsset(kind, assetId);
  const assets = await listAssets();
  const assetMap = createAssetMap(assets);
  const visiting = new Set();
  const visited = new Set();
  const flattenedAssets = new Map([[rootAsset.id, summarizeResolvedAsset(rootAsset)]]);
  const missing = [];
  const cycles = [];
  const edgeKeys = new Set();
  const edges = [];

  function buildNode(asset, stack = []) {
    visiting.add(asset.id);
    flattenedAssets.set(asset.id, summarizeResolvedAsset(asset));

    const resolvedDependencies = [];
    for (const dependency of asset.dependencies || []) {
      const edgeKey = `${asset.id}->${dependency.id}`;
      if (!edgeKeys.has(edgeKey)) {
        edgeKeys.add(edgeKey);
        edges.push({
          from: asset.id,
          to: dependency.id,
          kind: dependency.kind,
          required: dependency.required ?? true
        });
      }

      if (stack.includes(dependency.id) || visiting.has(dependency.id)) {
        const cyclePath = [...stack, asset.id, dependency.id];
        cycles.push(cyclePath);
        resolvedDependencies.push({
          kind: dependency.kind,
          id: dependency.id,
          required: dependency.required ?? true,
          status: "cycle",
          cyclePath
        });
        continue;
      }

      const dependencyAsset = assetMap.get(dependency.id);
      if (!dependencyAsset) {
        missing.push({
          from: asset.id,
          kind: dependency.kind,
          id: dependency.id,
          required: dependency.required ?? true
        });
        resolvedDependencies.push({
          kind: dependency.kind,
          id: dependency.id,
          required: dependency.required ?? true,
          status: "missing"
        });
        continue;
      }

      resolvedDependencies.push({
        kind: dependency.kind,
        id: dependency.id,
        required: dependency.required ?? true,
        status: "resolved",
        asset: summarizeResolvedAsset(dependencyAsset),
        dependencies: visited.has(dependency.id) ? undefined : buildNode(dependencyAsset, [...stack, asset.id])
      });
    }

    visiting.delete(asset.id);
    visited.add(asset.id);
    return resolvedDependencies;
  }

  const resolvedDependencies = buildNode(rootAsset);

  return {
    asset: rootAsset,
    resolvedDependencies,
    graph: {
      assets: [...flattenedAssets.values()].sort((left, right) => left.id.localeCompare(right.id)),
      edges: edges.sort((left, right) => `${left.from}:${left.to}`.localeCompare(`${right.from}:${right.to}`)),
      missing,
      cycles
    },
    summary: {
      directDependencyCount: (rootAsset.dependencies || []).length,
      resolvedAssetCount: flattenedAssets.size,
      missingDependencyCount: missing.length,
      cycleCount: cycles.length
    }
  };
}

export async function getAssetDependencies(kind, assetId) {
  const resolved = await showResolvedAsset(kind, assetId);

  return {
    id: resolved.asset.id,
    kind: resolved.asset.kind,
    version: resolved.asset.version,
    directDependencies: (resolved.asset.dependencies || []).map((dependency) => ({
      kind: dependency.kind,
      id: dependency.id,
      required: dependency.required ?? true,
      status:
        resolved.graph.missing.some((missing) => missing.kind === dependency.kind && missing.id === dependency.id) ? "missing" : "resolved"
    })),
    resolvedAssets: resolved.graph.assets.filter((asset) => asset.id !== resolved.asset.id),
    missing: resolved.graph.missing,
    cycles: resolved.graph.cycles,
    graph: resolved.graph,
    summary: resolved.summary
  };
}

export async function getAssetDependents(kind, assetId) {
  assertSupportedKind(kind);
  assertValidAssetId(kind, assetId);

  const assets = await listAssets();
  const targetAsset = assets.find((asset) => asset.id === assetId);
  if (!targetAsset) {
    throw new Error(`Asset not found: ${kind}:${assetId}`);
  }

  const directDependents = assets
    .filter((asset) => (asset.dependencies || []).some((dependency) => dependency.kind === kind && dependency.id === assetId))
    .map(summarizeResolvedAsset)
    .sort((left, right) => left.id.localeCompare(right.id));
  const paths = [];
  const seenUpstream = new Map();

  function walk(currentId, pathIds) {
    for (const asset of assets) {
      const dependsOnCurrent = (asset.dependencies || []).some((dependency) => dependency.id === currentId);
      if (!dependsOnCurrent || pathIds.includes(asset.id)) {
        continue;
      }

      const nextPathIds = [asset.id, ...pathIds];
      seenUpstream.set(asset.id, summarizeResolvedAsset(asset));
      paths.push(nextPathIds);
      walk(asset.id, nextPathIds);
    }
  }

  walk(assetId, [assetId]);

  return {
    id: targetAsset.id,
    kind: targetAsset.kind,
    version: targetAsset.version,
    directDependents,
    upstreamAssets: [...seenUpstream.values()].sort((left, right) => left.id.localeCompare(right.id)),
    paths: paths
      .map((pathIds) => ({
        assets: pathIds
      }))
      .sort((left, right) => left.assets.join(">").localeCompare(right.assets.join(">"))),
    summary: {
      directDependentCount: directDependents.length,
      upstreamAssetCount: seenUpstream.size,
      pathCount: paths.length
    }
  };
}

export async function getOrphanAssets(filters = {}) {
  if (filters.kind) {
    assertSupportedKind(filters.kind);
  }

  const assets = await listAssets();
  const referencedIds = new Set();
  for (const asset of assets) {
    for (const dependency of asset.dependencies || []) {
      referencedIds.add(dependency.id);
    }
  }

  const orphans = assets
    .filter((asset) => asset.kind !== "agent")
    .filter((asset) => !referencedIds.has(asset.id))
    .filter((asset) => !filters.kind || asset.kind === filters.kind)
    .map(summarizeResolvedAsset)
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    entryKinds: ["agent"],
    filters: {
      kind: filters.kind || null
    },
    orphanCount: orphans.length,
    orphans
  };
}

export async function getAssetImpact(kind, assetId) {
  const dependents = await getAssetDependents(kind, assetId);
  const affectedAssets = dependents.upstreamAssets;
  const affectedEntryAssets = affectedAssets
    .filter((asset) => asset.kind === "agent")
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    id: dependents.id,
    kind: dependents.kind,
    version: dependents.version,
    affectedAssets,
    affectedEntryAssets,
    suggestedPacks: affectedEntryAssets.map((asset) => ({
      entry: `${asset.kind}:${asset.id}`,
      reason: `Repack because ${asset.id} depends on ${assetId}.`
    })),
    paths: dependents.paths,
    summary: {
      affectedAssetCount: affectedAssets.length,
      affectedEntryAssetCount: affectedEntryAssets.length,
      suggestedPackCount: affectedEntryAssets.length,
      pathCount: dependents.paths.length
    }
  };
}

export async function getAssetHistory(kind, assetId) {
  assertSupportedKind(kind);
  assertValidAssetId(kind, assetId);
  const asset = await loadAsset(kind, assetId);

  return {
    id: asset.id,
    kind: asset.kind,
    currentVersion: asset.version,
    history: [...asset.history].sort((left, right) => compareSemver(right.version, left.version))
  };
}

export async function diffAsset(kind, assetId, fromVersion, toVersion) {
  assertSupportedKind(kind);
  assertValidAssetId(kind, assetId);
  const asset = await loadAsset(kind, assetId);
  const targetVersion = toVersion || asset.version;
  const left = await loadSnapshot(kind, assetId, fromVersion);
  const right = targetVersion === asset.version ? asset : await loadSnapshot(kind, assetId, targetVersion);

  const leftMetadata = stripRenderedContent(left);
  const rightMetadata = stripRenderedContent(right);

  return {
    id: assetId,
    kind,
    fromVersion,
    toVersion: targetVersion,
    metadataFieldsChanged: summarizeMetadataFieldChanges(leftMetadata, rightMetadata),
    hasContentChanges: left.renderedContent !== right.renderedContent,
    metadataDiff: createJsonDiff(leftMetadata, rightMetadata),
    contentDiff: createTextDiff(left.renderedContent, right.renderedContent)
  };
}

export async function validateWorkspace() {
  const issues = [];
  const workspace = await loadWorkspace();
  const assets = await listAssets();
  const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
  const dependencyCycleIssues = new Set();
  let availableTargets = new Set();

  if (!isNonEmptyString(workspace.name)) {
    issues.push("Workspace name is required.");
  }

  if (!isSemver(workspace.version)) {
    issues.push(`Workspace version must be semver: ${workspace.version}`);
  }

  if (!isNonEmptyString(workspace.timezone)) {
    issues.push("Workspace timezone is required.");
  }

  if (!Array.isArray(workspace.supportedTargets) || workspace.supportedTargets.length === 0) {
    issues.push("Workspace must declare supportedTargets.");
  }

  if (!isNonEmptyString(workspace.defaultTarget)) {
    issues.push("Workspace defaultTarget is required.");
  } else if (!workspace.supportedTargets?.includes(workspace.defaultTarget)) {
    issues.push(`Workspace defaultTarget must be included in supportedTargets: ${workspace.defaultTarget}`);
  }

  if (!isNonEmptyString(workspace.exportDirectory)) {
    issues.push("Workspace exportDirectory is required.");
  } else if (!isSafeRelativePath(workspace.exportDirectory)) {
    issues.push(`Workspace exportDirectory must be a safe relative path: ${workspace.exportDirectory}`);
  }

  if (workspace.bundleDirectory !== undefined) {
    if (!isNonEmptyString(workspace.bundleDirectory)) {
      issues.push("Workspace bundleDirectory must be a non-empty string.");
    } else if (!isSafeRelativePath(workspace.bundleDirectory)) {
      issues.push(`Workspace bundleDirectory must be a safe relative path: ${workspace.bundleDirectory}`);
    }
  }

  if (workspace.schemaVersion !== undefined && !isNonEmptyString(workspace.schemaVersion)) {
    issues.push("Workspace schemaVersion must be a non-empty string.");
  }

  if (!Array.isArray(workspace.adapterModules)) {
    issues.push("Workspace adapterModules must be an array.");
  } else {
    for (const adapterModule of workspace.adapterModules) {
      if (!isNonEmptyString(adapterModule)) {
        issues.push("Workspace adapterModules entries must be non-empty strings.");
        continue;
      }

      if (!isSafeRelativePath(adapterModule)) {
        issues.push(`Workspace adapterModules entry must be a safe relative path: ${adapterModule}`);
        continue;
      }

      if (!(await pathExists(path.resolve(process.cwd(), adapterModule)))) {
        issues.push(`Workspace adapter module is missing: ${adapterModule}`);
      }
    }
  }

  try {
    const targets = await listAdapterTargets(workspace);
    availableTargets = new Set(targets.map((item) => item.target));
  } catch (error) {
    issues.push(`Failed to load adapter modules: ${error.message}`);
  }

  if (Array.isArray(workspace.supportedTargets)) {
    const supportedTargets = new Set();
    for (const target of workspace.supportedTargets) {
      if (!isNonEmptyString(target)) {
        issues.push("Workspace supportedTargets entries must be non-empty strings.");
        continue;
      }

      if (supportedTargets.has(target)) {
        issues.push(`Workspace supportedTargets contains duplicates: ${target}`);
      }

      if (availableTargets.size > 0 && !availableTargets.has(target)) {
        issues.push(`Workspace supportedTargets references an unavailable adapter: ${target}`);
      }

      supportedTargets.add(target);
    }
  }

  for (const asset of assets) {
    if (!asset.id) {
      issues.push("Asset missing id.");
      continue;
    }

    if (!asset.id.startsWith(`${asset.kind}.`)) {
      issues.push(`Asset id must be prefixed with its kind: ${asset.id}`);
    }

    if (!isSupportedKind(asset.kind)) {
      issues.push(`Unsupported asset kind: ${asset.kind}`);
      continue;
    }

    if (!isValidAssetId(asset.kind, asset.id)) {
      issues.push(`Invalid asset id format: ${asset.id}`);
    }

    if (!asset.name) {
      issues.push(`Asset missing name: ${asset.id}`);
    }

    if (!isNonEmptyString(asset.description)) {
      issues.push(`Asset description is required: ${asset.id}`);
    }

    if (asset.status !== undefined && !supportedAssetStatuses.includes(asset.status)) {
      issues.push(`Asset status is unsupported: ${asset.id} -> ${asset.status}`);
    }

    if (asset.archive !== undefined) {
      if (asset.status !== "archived") {
        issues.push(`Asset archive metadata requires archived status: ${asset.id}`);
      }

      if (!isNonEmptyString(asset.archive.date)) {
        issues.push(`Asset archive date is required: ${asset.id}`);
      }

      if (!isNonEmptyString(asset.archive.reason)) {
        issues.push(`Asset archive reason is required: ${asset.id}`);
      }
    }

    if (!isNonEmptyString(asset.owner)) {
      issues.push(`Asset owner is required: ${asset.id}`);
    }

    if (!isSemver(asset.version)) {
      issues.push(`Asset version must be semver: ${asset.id} -> ${asset.version}`);
    }

    if (!asset.content?.entry) {
      issues.push(`Asset content.entry is required: ${asset.id}`);
    } else if (!isSafeRelativePath(asset.content.entry)) {
      issues.push(`Asset content.entry must be a safe relative path: ${asset.id} -> ${asset.content.entry}`);
    }

    if (!Array.isArray(asset.history) || asset.history.length === 0) {
      issues.push(`Asset history is required: ${asset.id}`);
    } else if (!asset.history.some((entry) => entry.version === asset.version)) {
      issues.push(`Current version missing from history: ${asset.id} -> ${asset.version}`);
    }

    if (!Array.isArray(asset.tags)) {
      issues.push(`Asset tags must be an array: ${asset.id}`);
    }

    if (!Array.isArray(asset.compatibility?.targets) || asset.compatibility.targets.length === 0) {
      issues.push(`Asset compatibility.targets is required: ${asset.id}`);
    }

    const compatibilityTargets = new Set();
    for (const target of asset.compatibility?.targets || []) {
      if (!isNonEmptyString(target)) {
        issues.push(`Asset compatibility target must be a non-empty string: ${asset.id}`);
        continue;
      }

      if (compatibilityTargets.has(target)) {
        issues.push(`Asset compatibility.targets contains duplicates: ${asset.id} -> ${target}`);
      }

      if (!workspace.supportedTargets.includes(target)) {
        issues.push(`Unsupported compatibility target on ${asset.id}: ${target}`);
      }

      compatibilityTargets.add(target);
    }

    validateAssetDependencies(asset, assetMap, issues, dependencyCycleIssues);

    const assetDir = resolveAssetPath(asset.kind, asset.id);
    const contentPath = path.join(assetDir, asset.content.entry);
    if (!(await pathExists(contentPath))) {
      issues.push(`Missing content file: ${asset.id} -> ${asset.content.entry}`);
    }

    const historyVersions = new Set();
    let lastHistoryEntry = null;
    for (const entry of asset.history || []) {
      const snapshotDir = path.join(assetDir, entry.snapshot || "");
      if (!isSemver(entry.version)) {
        issues.push(`History entry version must be semver: ${asset.id} -> ${entry.version}`);
      }

      if (historyVersions.has(entry.version)) {
        issues.push(`History entry version must be unique: ${asset.id} -> ${entry.version}`);
      }
      historyVersions.add(entry.version);

      if (!isNonEmptyString(entry.date)) {
        issues.push(`History entry date is required: ${asset.id} -> ${entry.version}`);
      }

      if (!isNonEmptyString(entry.notes)) {
        issues.push(`History entry notes are required: ${asset.id} -> ${entry.version}`);
      }

      if (!entry.snapshot) {
        issues.push(`History entry missing snapshot path: ${asset.id} -> ${entry.version}`);
        continue;
      }

      if (!isSafeRelativePath(entry.snapshot)) {
        issues.push(`History entry snapshot must be a safe relative path: ${asset.id} -> ${entry.snapshot}`);
        continue;
      }

      const expectedSnapshotPath = `.snapshots/${entry.version}`;
      if (entry.snapshot !== expectedSnapshotPath) {
        issues.push(`History entry snapshot path must match version: ${asset.id} -> ${entry.version}`);
      }

      const snapshotMetadataPath = path.join(snapshotDir, "asset.json");
      if (!(await pathExists(snapshotMetadataPath))) {
        issues.push(`Missing snapshot metadata: ${asset.id} -> ${entry.version}`);
      } else {
        const snapshotMetadata = await readJson(snapshotMetadataPath);
        if (snapshotMetadata.id !== asset.id) {
          issues.push(`Snapshot metadata id mismatch: ${asset.id} -> ${entry.version}`);
        }

        if (snapshotMetadata.kind !== asset.kind) {
          issues.push(`Snapshot metadata kind mismatch: ${asset.id} -> ${entry.version}`);
        }

        if (snapshotMetadata.version !== entry.version) {
          issues.push(`Snapshot metadata version mismatch: ${asset.id} -> ${entry.version}`);
        }

        if (snapshotMetadata.content?.entry !== asset.content.entry) {
          issues.push(`Snapshot content.entry mismatch: ${asset.id} -> ${entry.version}`);
        }
      }

      if (!(await pathExists(path.join(snapshotDir, asset.content.entry)))) {
        issues.push(`Missing snapshot content: ${asset.id} -> ${entry.version}`);
      }

      if (!lastHistoryEntry || compareSemver(entry.version, lastHistoryEntry.version) > 0) {
        lastHistoryEntry = entry;
      }
    }

    if (lastHistoryEntry && asset.version !== lastHistoryEntry.version) {
      issues.push(`Asset current version must match latest history entry: ${asset.id} -> ${asset.version}`);
    }
  }

  issues.push(...[...dependencyCycleIssues].sort((left, right) => left.localeCompare(right)));

  return {
    valid: issues.length === 0,
    issueCount: issues.length,
    assetCount: assets.length,
    issues
  };
}

export async function exportWorkspace(target, options = {}) {
  const workspace = await loadWorkspace();
  const assets = await listAssets();
  const resolvedTarget = target || workspace.defaultTarget;
  const entry = options.entry;
  const includeDependencies = options.includeDependencies === true;

  if (!resolvedTarget) {
    throw new Error("No export target provided and workspace.defaultTarget is not set");
  }

  if (!workspace.supportedTargets.includes(resolvedTarget)) {
    throw new Error(`Target ${resolvedTarget} is not enabled in workspace.supportedTargets`);
  }

  const exportAssets = selectExportAssets(assets, resolvedTarget, entry, includeDependencies);
  const output = await renderForTarget(resolvedTarget, workspace, exportAssets);
  const exportDirectory = getWorkspaceExportDirectory(workspace);
  const outputPath = path.join(exportDirectory, `${resolvedTarget}.json`);

  await writeJson(outputPath, output);

  return {
    outputPath,
    target: resolvedTarget,
    assetCount: exportAssets.length,
    entry: entry ? `${entry.kind}:${entry.id}` : null,
    includeDependencies
  };
}

export async function packWorkspace(target, options = {}) {
  const workspace = await loadWorkspace();
  const resolvedTarget = target || workspace.defaultTarget;
  const entry = options.entry;
  const includeDependencies = options.includeDependencies === true;
  const channel = options.channel || "draft";

  if (!entry) {
    throw new Error("Pack requires --entry <kind:id>");
  }

  if (!supportedBundleChannels.includes(channel)) {
    throw new Error(`Unsupported bundle channel: ${channel}. Supported channels: ${supportedBundleChannels.join(", ")}`);
  }

  if (channel === "stable") {
    const validationResult = await validateWorkspace();
    if (!validationResult.valid) {
      throw new Error(`Stable pack requires a valid workspace: ${validationResult.issues[0]}`);
    }
  }

  if (options.output && !isSafeRelativePath(options.output)) {
    throw new Error(`Pack output must be a safe relative path: ${options.output}`);
  }

  const assets = await listAssets();
  const assetMap = createAssetMap(assets);
  const rootAsset = assetMap.get(entry.id);
  if (!rootAsset) {
    throw new Error(`Entry asset not found: ${entry.kind}:${entry.id}`);
  }

  const selection = resolveAssetSelection(rootAsset, assetMap, { includeDependencies });
  const exportAssets = selectExportAssets(assets, resolvedTarget, entry, includeDependencies);
  const renderedOutput = await renderForTarget(resolvedTarget, workspace, exportAssets);
  const bundleDirectory = options.output
    ? resolveExportDirectory(options.output)
    : path.join(getWorkspaceBundleDirectory(workspace), `${entry.id}-${resolvedTarget}`);

  const manifest = {
    bundleVersion: "1",
    workspace: {
      name: workspace.name,
      version: workspace.version,
      schemaVersion: workspace.schemaVersion || "1"
    },
    target: resolvedTarget,
    channel,
    entryAsset: {
      kind: rootAsset.kind,
      id: rootAsset.id,
      version: rootAsset.version
    },
    includeDependencies,
    includedAssets: selection.assets.map((asset) => ({
      kind: asset.kind,
      id: asset.id,
      version: asset.version
    })),
    generatedAt: currentTimestamp()
  };

  const assetsDocument = {
    workspace: {
      name: workspace.name,
      version: workspace.version
    },
    target: resolvedTarget,
    channel,
    entry: `${entry.kind}:${entry.id}`,
    includeDependencies,
    assets: selection.assets.map(toBundleAsset)
  };
  const renderedPath = `rendered/${resolvedTarget}.json`;
  const payloadDigests = {
    "assets.json": digestJson(assetsDocument),
    [renderedPath]: digestJson(renderedOutput)
  };
  manifest.digest = {
    algorithm: "sha256",
    files: payloadDigests
  };

  const checksumsDocument = {
    algorithm: "sha256",
    files: {
      "manifest.json": digestJson(normalizeManifestForDigest(manifest)),
      ...payloadDigests
    }
  };

  await writeJson(path.join(bundleDirectory, "manifest.json"), manifest);
  await writeJson(path.join(bundleDirectory, "assets.json"), assetsDocument);
  await writeJson(path.join(bundleDirectory, renderedPath), renderedOutput);
  await writeJson(path.join(bundleDirectory, "checksums.json"), checksumsDocument);

  const archivePath = `${bundleDirectory}.tar.gz`;
  if (options.archive === true) {
    await writeFile(
      archivePath,
      createTarGzip([
        {
          name: "manifest.json",
          content: stableStringify(manifest) + "\n"
        },
        {
          name: "assets.json",
          content: stableStringify(assetsDocument) + "\n"
        },
        {
          name: renderedPath,
          content: stableStringify(renderedOutput) + "\n"
        },
        {
          name: "checksums.json",
          content: stableStringify(checksumsDocument) + "\n"
        }
      ])
    );
  }

  return {
    bundlePath: bundleDirectory,
    manifestPath: path.join(bundleDirectory, "manifest.json"),
    assetsPath: path.join(bundleDirectory, "assets.json"),
    renderedPath: path.join(bundleDirectory, renderedPath),
    checksumsPath: path.join(bundleDirectory, "checksums.json"),
    archivePath: options.archive === true ? archivePath : null,
    target: resolvedTarget,
    channel,
    entry: `${entry.kind}:${entry.id}`,
    includeDependencies,
    assetCount: selection.assets.length
  };
}

async function readBundleJson(bundlePath, relativePath, issues) {
  const filePath = path.join(bundlePath, relativePath);
  if (!(await pathExists(filePath))) {
    issues.push(`Missing bundle file: ${relativePath}`);
    return null;
  }

  try {
    return await readJson(filePath);
  } catch (error) {
    issues.push(`Invalid bundle JSON: ${relativePath} (${error.message})`);
    return null;
  }
}

function compareDigest(relativePath, actualDigest, expectedDigest, issues) {
  if (!expectedDigest) {
    issues.push(`Missing expected digest: ${relativePath}`);
    return;
  }

  if (actualDigest !== expectedDigest) {
    issues.push(`Digest mismatch: ${relativePath}`);
  }
}

export async function verifyBundle(bundlePathInput) {
  if (!isNonEmptyString(bundlePathInput)) {
    throw new Error("Bundle path is required.");
  }

  const bundlePath = path.resolve(process.cwd(), bundlePathInput);
  const issues = [];
  const manifest = await readBundleJson(bundlePath, "manifest.json", issues);
  const assetsDocument = await readBundleJson(bundlePath, "assets.json", issues);
  const checksums = await readBundleJson(bundlePath, "checksums.json", issues);
  const renderedRelativePath = manifest?.target ? `rendered/${manifest.target}.json` : null;
  const renderedOutput = renderedRelativePath ? await readBundleJson(bundlePath, renderedRelativePath, issues) : null;

  if (manifest && checksums) {
    if (checksums.algorithm !== "sha256") {
      issues.push(`Unsupported checksum algorithm: ${checksums.algorithm}`);
    }

    compareDigest("manifest.json", digestJson(normalizeManifestForDigest(manifest)), checksums.files?.["manifest.json"], issues);
  }

  if (assetsDocument && checksums) {
    compareDigest("assets.json", digestJson(assetsDocument), checksums.files?.["assets.json"], issues);
  }

  if (renderedRelativePath && renderedOutput && checksums) {
    compareDigest(renderedRelativePath, digestJson(renderedOutput), checksums.files?.[renderedRelativePath], issues);
  }

  if (manifest?.digest && checksums) {
    if (manifest.digest.algorithm !== checksums.algorithm) {
      issues.push("Manifest digest algorithm does not match checksums algorithm.");
    }

    for (const [relativePath, digest] of Object.entries(manifest.digest.files || {})) {
      if (checksums.files?.[relativePath] !== digest) {
        issues.push(`Manifest digest does not match checksums entry: ${relativePath}`);
      }
    }
  }

  if (manifest && assetsDocument) {
    const manifestAssets = (manifest.includedAssets || [])
      .map((asset) => `${asset.kind}:${asset.id}@${asset.version}`)
      .sort((left, right) => left.localeCompare(right));
    const payloadAssets = (assetsDocument.assets || [])
      .map((asset) => `${asset.kind}:${asset.id}@${asset.version}`)
      .sort((left, right) => left.localeCompare(right));

    if (stableStringify(manifestAssets) !== stableStringify(payloadAssets)) {
      issues.push("Manifest includedAssets do not match assets payload.");
    }
  }

  return {
    valid: issues.length === 0,
    issueCount: issues.length,
    issues,
    bundlePath,
    files: {
      manifest: path.join(bundlePath, "manifest.json"),
      assets: path.join(bundlePath, "assets.json"),
      checksums: path.join(bundlePath, "checksums.json"),
      rendered: renderedRelativePath ? path.join(bundlePath, renderedRelativePath) : null
    }
  };
}
