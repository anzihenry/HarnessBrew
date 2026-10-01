import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyArtifact } from "../artifact/verify.mjs";
import { buildArtifact } from "../artifact/build.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const suite = process.argv[2] ?? "fast";
if (!["fast", "packaged", "regressions"].includes(suite)) throw new Error(`Unknown test suite: ${suite}`);
const packaged = new Set([
  "artifact.test.js", "e2e-fixture.test.js", "e2e-harness.test.js", "e2e-lifecycle.test.js",
  "e2e-target-matrix.test.js", "e2e-cli-contract.test.js", "e2e-bundle-reproduction.test.js",
  "e2e-upgrade-repair.test.js", "package-smoke.test.js", "release-gate.test.js", "runtime-preflight.test.js"
]);
const tests = (await readdir(path.join(projectRoot, ".test-dist/tests")))
  .filter(name => name.endsWith(".test.js"))
  .filter(name => suite === "packaged" ? packaged.has(name)
    : suite === "regressions" ? name === "phase2-regressions.test.js"
    : !packaged.has(name) && name !== "phase2-regressions.test.js")
  .sort().map(name => path.join(projectRoot, ".test-dist/tests", name));
if (!tests.length) throw new Error(`No tests for ${suite}; run npm run build:test first.`);
let candidateDirectory;
try {
  const environment = { ...process.env };
  delete environment.HARNESSBREW_TEST_CANDIDATE;
  if (suite === "packaged") {
    if (process.env.HARNESSBREW_TEST_CANDIDATE) {
      const shared = path.resolve(process.env.HARNESSBREW_TEST_CANDIDATE);
      const manifest = JSON.parse(await readFile(path.join(shared, "artifact-manifest.json"), "utf8"));
      if (path.basename(manifest.package.filename) !== manifest.package.filename) throw new Error("Invalid candidate filename");
      await verifyArtifact({ packagePath: path.join(shared, manifest.package.filename),
        manifestPath: path.join(shared, "artifact-manifest.json"), checksumsPath: path.join(shared, "SHA256SUMS") });
      environment.HARNESSBREW_TEST_CANDIDATE = shared;
    } else {
      candidateDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-test-candidate-"));
      await buildArtifact({ outputDirectory: candidateDirectory, allowDirty: true });
      environment.HARNESSBREW_TEST_CANDIDATE = candidateDirectory;
    }
    console.log("Packaged tests share one candidate; each test receives a private copy.");
  }
  const child = spawn(process.execPath, ["--test", "--test-concurrency=2", ...tests], {
    cwd: projectRoot, env: environment, stdio: "inherit"
  });
  process.exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(signal ? 1 : code ?? 1));
  });
} finally {
  if (candidateDirectory !== undefined) await rm(candidateDirectory, { recursive: true, force: true });
}
