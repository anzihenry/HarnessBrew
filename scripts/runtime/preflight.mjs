import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { installCandidate } from "../artifact/install-candidate.mjs";
import { parseNamedArguments } from "../artifact/manifest.mjs";
import { verifyArtifact } from "../artifact/verify.mjs";
import { PackagedCliDriver } from "../e2e/cli-driver.mjs";
import { runClaudeProbe } from "./claude.mjs";
import { runCodexProbe } from "./codex.mjs";
import { createRuntimeFixture } from "./fixture.mjs";
import { spawnCapture } from "./process.mjs";

const execFileAsync = promisify(execFile);
const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), "../..");

function probes(markers, runtime) {
  return [
    {
      name: "skill",
      marker: markers.skill,
      prompt: "Explicitly invoke $harnessbrew-runtime-skill and follow it. Include its verification marker in the final response."
    },
    {
      name: "instruction",
      marker: markers.instruction,
      prompt: "Reply with READY while obeying every active project instruction."
    },
    {
      name: "agent",
      marker: markers.agent,
      prompt: "Delegate this probe to the custom harnessbrew-runtime-agent subagent and return the marker it reports.",
      requiredEvent: runtime === "codex"
        ? { textIncludes: "harnessbrew-runtime-agent" }
        : { toolNameIncludes: "Task", textIncludes: "harnessbrew-runtime-agent" }
    },
    {
      name: "mcp",
      marker: markers.mcp,
      prompt: "Call the harnessbrew-runtime-mcp tool harnessbrew_runtime_nonce and include its exact result in the final response.",
      requiredEvent: runtime === "codex"
        ? { itemType: "mcp_tool_call", textIncludes: "harnessbrew_runtime_nonce" }
        : { toolNameIncludes: "harnessbrew_runtime_nonce", textIncludes: "harnessbrew-runtime-mcp" }
    }
  ];
}

async function versionOf(adapter, cwd, environment) {
  if (adapter.version !== undefined) return adapter.version;
  try {
    const result = await spawnCapture(adapter.binary, ["--version"], { cwd, environment, timeoutMs: 10_000 });
    if (result.exitCode !== 0) return undefined;
    return result.stdout.trim().split(/\r?\n/u)[0];
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function mcpCalls(logPath, marker) {
  try {
    return (await readFile(logPath, "utf8")).split(/\r?\n/u).filter((line) => {
      if (line === "") return false;
      const event = JSON.parse(line);
      return event.event === "tool-called" && event.nonce === marker;
    }).length;
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
}

async function runRuntime(adapter, fixture, cwd, environment) {
  const cliVersion = await versionOf(adapter, cwd, environment);
  if (cliVersion === undefined) {
    return {
      name: adapter.name,
      cliVersion: null,
      status: "skipped",
      failureClass: "environment-failure",
      diagnostic: `${adapter.name} CLI is not installed or not executable.`,
      probes: []
    };
  }
  const results = [];
  for (const probe of probes(fixture.markers, adapter.runtime)) {
    const beforeMcpCalls = probe.name === "mcp" ? await mcpCalls(fixture.mcpLog, fixture.markers.mcp) : 0;
    let result = await adapter.runProbe({ probe, cwd, binary: adapter.binary, environment, fixture });
    let attempts = 1;
    if (result.failureClass === "behavioral-failure") {
      result = await adapter.runProbe({ probe, cwd, binary: adapter.binary, environment, fixture });
      attempts = 2;
    }
    if (probe.name === "mcp" && result.status === "passed") {
      const afterMcpCalls = await mcpCalls(fixture.mcpLog, fixture.markers.mcp);
      if (afterMcpCalls <= beforeMcpCalls) {
        result = {
          ...result,
          status: "failed",
          failureClass: "product-failure",
          diagnostic: "The MCP event stream was present, but the local fixture did not record the tool call."
        };
      }
    }
    if (result.failureClass === "environment-failure") result = { ...result, status: "skipped" };
    results.push({ ...result, attempts });
  }
  const status = results.every((result) => result.status === "passed")
    ? "passed"
    : results.some((result) => result.status === "failed") ? "failed" : "skipped";
  return { name: adapter.name, cliVersion, status, probes: results };
}

async function installRuntimeAssets(cli, fixture, project) {
  await cli.run(["tap", "add", fixture.name, fixture.remote, "--trust"]);
  const formulas = [
    "harnessbrew-runtime-skill",
    "harnessbrew-runtime-instruction",
    "harnessbrew-runtime-agent",
    "harnessbrew-runtime-mcp"
  ];
  for (const formula of formulas) {
    await cli.run(["install", formula]);
    for (const target of ["openai-codex", "claude-code"]) {
      await cli.run(["link", formula, "--target", target, "--scope", "project", "--project", project]);
    }
  }
}

export async function runRuntimePreflight({
  packagePath,
  manifestPath,
  checksumsPath,
  reportDirectory,
  allowSkips = false,
  keep = false,
  runtimeAdapters
}) {
  const artifact = await verifyArtifact({
    packagePath,
    manifestPath,
    ...(checksumsPath === undefined ? {} : { checksumsPath })
  });
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-runtime-"));
  const startedAt = new Date().toISOString();
  const paths = {
    home: path.join(root, "home"),
    harnessHome: path.join(root, "harnessbrew-home"),
    installPrefix: path.join(root, "candidate"),
    project: path.join(root, "project"),
    npmCache: path.join(root, "npm-cache"),
    gitConfig: path.join(root, "gitconfig")
  };
  const reportRoot = path.resolve(reportDirectory ?? path.join(path.dirname(artifact.manifestPath), "runtime-evidence"));
  let report;
  try {
    await Promise.all(Object.values(paths).filter((candidate) => candidate !== paths.gitConfig)
      .map((candidate) => mkdir(candidate, { recursive: true })));
    await writeFile(paths.gitConfig, "[user]\n\tname = HarnessBrew Runtime\n\temail = runtime@harnessbrew.invalid\n", "utf8");
    const isolatedEnvironment = {
      ...process.env,
      HARNESSBREW_HOME: paths.harnessHome,
      NPM_CONFIG_CACHE: paths.npmCache,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: paths.gitConfig
    };
    await execFileAsync("git", ["init", "--initial-branch=main"], { cwd: paths.project, env: isolatedEnvironment });
    await installCandidate({
      packagePath: artifact.packagePath,
      installPrefix: paths.installPrefix,
      projectRoot,
      cachePath: path.join(projectRoot, ".npm-cache"),
      environment: isolatedEnvironment
    });
    const binary = path.join(paths.installPrefix, "node_modules", ".bin", process.platform === "win32" ? "harnessbrew.cmd" : "harnessbrew");
    const nonce = randomBytes(12).toString("hex").toUpperCase();
    const fixture = await createRuntimeFixture({
      root,
      nonce,
      mcpServerPath: path.join(projectRoot, "scripts", "runtime", "mcp-fixture.mjs"),
      environment: isolatedEnvironment
    });
    const cli = new PackagedCliDriver({ binary, root, paths: { project: paths.project }, environment: isolatedEnvironment });
    await installRuntimeAssets(cli, fixture, paths.project);
    const adapters = runtimeAdapters ?? [
      { name: "codex", runtime: "codex", binary: "codex", runProbe: runCodexProbe },
      { name: "claude-code", runtime: "claude-code", binary: "claude", runProbe: runClaudeProbe }
    ];
    const runtimes = [];
    for (const adapter of adapters) runtimes.push(await runRuntime(adapter, fixture, paths.project, process.env));
    const requiredPass = runtimes.every((runtime) => runtime.status === "passed");
    const tolerated = allowSkips && runtimes.every((runtime) => runtime.status === "passed" || runtime.status === "skipped");
    report = {
      schemaVersion: 1,
      artifact: {
        filename: artifact.manifest.package.filename,
        version: artifact.manifest.package.version,
        sha256: artifact.manifest.package.sha256,
        commit: artifact.manifest.source.commit
      },
      environment: {
        platform: process.platform,
        architecture: process.arch,
        node: process.version
      },
      startedAt,
      completedAt: new Date().toISOString(),
      status: requiredPass ? "passed" : tolerated ? "incomplete" : "failed",
      runtimes
    };
    await mkdir(reportRoot, { recursive: true });
    const reportPath = path.join(reportRoot, "runtime-report.json");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return { report, reportPath, root };
  } finally {
    if (!keep) await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  const { values, flags } = parseNamedArguments(
    process.argv.slice(2),
    ["--package", "--manifest", "--checksums", "--report-dir"],
    ["--allow-skips", "--keep"]
  );
  const packagePath = values.get("--package");
  const manifestPath = values.get("--manifest");
  if (packagePath === undefined || manifestPath === undefined) {
    throw new Error("Usage: npm run release:preflight -- --package <candidate.tgz> --manifest <artifact-manifest.json> [--checksums <SHA256SUMS>] [--report-dir <directory>] [--allow-skips] [--keep]");
  }
  const result = await runRuntimePreflight({
    packagePath,
    manifestPath,
    ...(values.get("--checksums") === undefined ? {} : { checksumsPath: values.get("--checksums") }),
    ...(values.get("--report-dir") === undefined ? {} : { reportDirectory: values.get("--report-dir") }),
    allowSkips: flags.has("--allow-skips"),
    keep: flags.has("--keep")
  });
  console.log(`Runtime preflight ${result.report.status}: ${result.reportPath}`);
  if (result.report.status === "failed") process.exitCode = 1;
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
