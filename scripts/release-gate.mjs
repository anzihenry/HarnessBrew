import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseNamedArguments } from "./artifact/manifest.mjs";
import { verifyArtifact } from "./artifact/verify.mjs";
import { runPackagedE2E } from "./e2e/run.mjs";
import { smokePackage } from "./package-smoke.mjs";

const scriptPath = fileURLToPath(import.meta.url);

export async function runReleaseGate({
  packagePath,
  manifestPath,
  checksumsPath,
  reportDirectory,
  cachePath,
  smoke = smokePackage,
  e2e = runPackagedE2E
}) {
  const verified = await verifyArtifact({
    packagePath,
    manifestPath,
    ...(checksumsPath === undefined ? {} : { checksumsPath })
  });
  const reportRoot = path.resolve(reportDirectory);
  await mkdir(reportRoot, { recursive: true });
  const startedAt = new Date().toISOString();
  await smoke({
    packagePath: verified.packagePath,
    manifestPath: verified.manifestPath,
    ...(checksumsPath === undefined ? {} : { checksumsPath }),
    ...(cachePath === undefined ? {} : { cachePath })
  });
  await e2e({
    packagePath: verified.packagePath,
    manifestPath: verified.manifestPath,
    ...(checksumsPath === undefined ? {} : { checksumsPath }),
    ...(cachePath === undefined ? {} : { cachePath }),
    reportDirectory: reportRoot
  });
  const report = {
    schemaVersion: 1,
    status: "passed",
    artifact: {
      filename: verified.manifest.package.filename,
      version: verified.manifest.package.version,
      sha256: verified.manifest.package.sha256,
      commit: verified.manifest.source.commit
    },
    platform: process.platform,
    architecture: process.arch,
    startedAt,
    completedAt: new Date().toISOString(),
    checks: ["artifact", "package-smoke", "packaged-e2e"]
  };
  const reportPath = path.join(reportRoot, "release-gate.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return { report, reportPath };
}

async function main() {
  const { values } = parseNamedArguments(process.argv.slice(2), [
    "--package", "--manifest", "--checksums", "--report-dir", "--cache"
  ]);
  const packagePath = values.get("--package");
  const manifestPath = values.get("--manifest");
  const reportDirectory = values.get("--report-dir");
  if (packagePath === undefined || manifestPath === undefined || reportDirectory === undefined) {
    throw new Error("Usage: npm run release:gate -- --package <candidate.tgz> --manifest <artifact-manifest.json> --report-dir <directory> [--checksums <SHA256SUMS>] [--cache <npm-cache>]");
  }
  const result = await runReleaseGate({
    packagePath,
    manifestPath,
    reportDirectory,
    ...(values.get("--checksums") === undefined ? {} : { checksumsPath: values.get("--checksums") }),
    ...(values.get("--cache") === undefined ? {} : { cachePath: values.get("--cache") })
  });
  console.log(`Release gate passed: ${result.reportPath}`);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
