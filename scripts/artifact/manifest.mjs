import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const ARTIFACT_MANIFEST_SCHEMA_VERSION = 1;

export async function sha256File(filePath) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function requireString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Artifact manifest ${field} must be a non-empty string.`);
  }
  return value;
}

export function validateArtifactManifest(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Artifact manifest must be an object.");
  }
  if (value.schemaVersion !== ARTIFACT_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`Unsupported artifact manifest schema: ${String(value.schemaVersion)}`);
  }
  if (typeof value.package !== "object" || value.package === null || Array.isArray(value.package)) {
    throw new Error("Artifact manifest package must be an object.");
  }
  if (typeof value.source !== "object" || value.source === null || Array.isArray(value.source)) {
    throw new Error("Artifact manifest source must be an object.");
  }
  if (typeof value.runtime !== "object" || value.runtime === null || Array.isArray(value.runtime)) {
    throw new Error("Artifact manifest runtime must be an object.");
  }

  const manifest = {
    schemaVersion: ARTIFACT_MANIFEST_SCHEMA_VERSION,
    package: {
      name: requireString(value.package.name, "package.name"),
      version: requireString(value.package.version, "package.version"),
      filename: requireString(value.package.filename, "package.filename"),
      sha256: requireString(value.package.sha256, "package.sha256")
    },
    source: {
      commit: requireString(value.source.commit, "source.commit"),
      tag: requireString(value.source.tag, "source.tag"),
      dirty: value.source.dirty
    },
    runtime: {
      node: requireString(value.runtime.node, "runtime.node"),
      npm: requireString(value.runtime.npm, "runtime.npm"),
      platform: requireString(value.runtime.platform, "runtime.platform"),
      architecture: requireString(value.runtime.architecture, "runtime.architecture")
    },
    createdAt: requireString(value.createdAt, "createdAt")
  };

  if (!/^[a-f0-9]{64}$/u.test(manifest.package.sha256)) {
    throw new Error("Artifact manifest package.sha256 must be a lowercase SHA-256 digest.");
  }
  if (!manifest.package.filename.endsWith(".tgz") || path.basename(manifest.package.filename) !== manifest.package.filename) {
    throw new Error("Artifact manifest package.filename must be a .tgz basename.");
  }
  if (manifest.source.dirty !== true && manifest.source.dirty !== false) {
    throw new Error("Artifact manifest source.dirty must be a boolean.");
  }
  if (Number.isNaN(Date.parse(manifest.createdAt))) {
    throw new Error("Artifact manifest createdAt must be an ISO-8601 timestamp.");
  }
  return manifest;
}

export async function readArtifactManifest(manifestPath) {
  let value;
  try {
    value = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`Invalid artifact manifest JSON: ${manifestPath}`);
    throw error;
  }
  return validateArtifactManifest(value);
}

export function parseNamedArguments(argv, valueNames, flagNames = []) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (flagNames.includes(argument)) {
      flags.add(argument);
      continue;
    }
    if (!valueNames.includes(argument)) throw new Error(`Unknown argument: ${argument}`);
    if (values.has(argument)) throw new Error(`Duplicate argument: ${argument}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    values.set(argument, value);
    index += 1;
  }
  return { values, flags };
}
