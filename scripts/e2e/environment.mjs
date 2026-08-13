import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { verifyArtifact } from "../artifact/verify.mjs";

const execFileAsync = promisify(execFile);
const markerFilename = ".harnessbrew-e2e-root";
const sensitiveEnvironmentPattern = /(?:OPENAI|ANTHROPIC|CLAUDE|CODEX_API|API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SECRET)/iu;

export function assertPathInside(root, candidate, label = "path") {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    return resolvedCandidate;
  }
  throw new Error(`E2E ${label} escapes its isolated root: ${resolvedCandidate}`);
}

function isolatedProcessEnvironment(root, paths) {
  const environment = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !sensitiveEnvironmentPattern.test(name)) environment[name] = value;
  }
  return {
    ...environment,
    HOME: paths.home,
    USERPROFILE: paths.home,
    XDG_CONFIG_HOME: paths.xdgConfig,
    HARNESSBREW_HOME: paths.harnessHome,
    NPM_CONFIG_CACHE: paths.npmCache,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: paths.gitConfig,
    HARNESSBREW_E2E_ROOT: root
  };
}

async function ensureFreshRoot(requestedRoot) {
  if (requestedRoot === undefined) return mkdtemp(path.join(tmpdir(), "harnessbrew-e2e-"));
  const root = path.resolve(requestedRoot);
  try {
    await lstat(root);
    throw new Error(`Requested E2E root already exists: ${root}`);
  } catch (error) {
    if ((error).code !== "ENOENT") throw error;
  }
  await mkdir(root, { recursive: false });
  return root;
}

export async function createE2EEnvironment({
  packagePath,
  manifestPath,
  checksumsPath,
  cachePath,
  root: requestedRoot,
  keep = false
}) {
  const verified = await verifyArtifact({
    packagePath,
    manifestPath,
    ...(checksumsPath === undefined ? {} : { checksumsPath })
  });
  const root = await ensureFreshRoot(requestedRoot);
  const marker = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const paths = {
    root,
    home: path.join(root, "home"),
    xdgConfig: path.join(root, "xdg-config"),
    harnessHome: path.join(root, "harnessbrew-home"),
    installPrefix: path.join(root, "install-prefix"),
    project: path.join(root, "project"),
    codexRoot: path.join(root, "codex-root"),
    claudeRoot: path.join(root, "claude-root"),
    tapAuthor: path.join(root, "tap-author"),
    tapRemote: path.join(root, "tap-remote.git"),
    reports: path.join(root, "reports"),
    logs: path.join(root, "logs"),
    npmCache: path.join(root, "npm-cache"),
    gitConfig: path.join(root, "gitconfig")
  };
  Object.entries(paths).forEach(([name, candidate]) => assertPathInside(root, candidate, name));
  await Promise.all([
    mkdir(paths.home, { recursive: true }),
    mkdir(paths.xdgConfig, { recursive: true }),
    mkdir(paths.harnessHome, { recursive: true }),
    mkdir(paths.project, { recursive: true }),
    mkdir(paths.codexRoot, { recursive: true }),
    mkdir(paths.claudeRoot, { recursive: true }),
    mkdir(paths.reports, { recursive: true }),
    mkdir(paths.logs, { recursive: true }),
    mkdir(paths.npmCache, { recursive: true })
  ]);
  await writeFile(path.join(root, markerFilename), `${marker}\n`, "utf8");
  await writeFile(paths.gitConfig, [
    "[user]",
    "\tname = HarnessBrew E2E",
    "\temail = e2e@harnessbrew.invalid",
    "[init]",
    "\tdefaultBranch = main",
    ""
  ].join("\n"), "utf8");

  const environment = isolatedProcessEnvironment(root, paths);
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  await execFileAsync(npmCommand, [
    "install",
    "--prefix",
    paths.installPrefix,
    verified.packagePath,
    "--ignore-scripts",
    "--package-lock=false",
    "--cache",
    path.resolve(cachePath ?? paths.npmCache)
  ], { encoding: "utf8", env: environment, maxBuffer: 10 * 1024 * 1024 });

  const binary = path.join(
    paths.installPrefix,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "harnessbrew.cmd" : "harnessbrew"
  );
  await access(binary);
  assertPathInside(root, binary, "candidate executable");

  let cleaned = false;
  return {
    root,
    paths,
    environment,
    binary,
    artifact: verified.manifest,
    keep,
    async cleanup() {
      if (cleaned || keep) return;
      const markerPath = assertPathInside(root, path.join(root, markerFilename), "cleanup marker");
      assert.equal((await readFile(markerPath, "utf8")).trim(), marker, "E2E cleanup marker changed");
      assert.ok(path.basename(root).startsWith("harnessbrew-e2e-") || requestedRoot !== undefined, "refusing to clean an unrecognized E2E root");
      await rm(root, { recursive: true, force: false });
      cleaned = true;
    }
  };
}
