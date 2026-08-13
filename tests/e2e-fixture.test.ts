import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

interface ArtifactBuildResult { packagePath: string; manifestPath: string; checksumsPath: string }
interface ArtifactModule {
  buildArtifact(options: { outputDirectory: string; allowDirty?: boolean }): Promise<ArtifactBuildResult>;
}
interface E2EEnvironment {
  root: string;
  environment: NodeJS.ProcessEnv;
  paths: { tapAuthor: string; tapRemote: string };
  cleanup(): Promise<void>;
}
interface EnvironmentModule {
  createE2EEnvironment(options: ArtifactBuildResult): Promise<E2EEnvironment>;
}
interface FixtureModule {
  createTapFixture(environment: E2EEnvironment): Promise<{
    name: string;
    author: string;
    remote: string;
    v1Commit: string;
    definitions: Array<{ name: string; kind: string; coordinate: string }>;
    pushV2(): Promise<string>;
    pushInvalidCandidate(): Promise<string>;
    repairInvalidCandidate(): Promise<string>;
    rewriteFromV1(): Promise<string>;
  }>;
}

const artifactModule = await import(pathToFileURL(path.resolve("scripts/artifact/build.mjs")).href) as ArtifactModule;
const environmentModule = await import(pathToFileURL(path.resolve("scripts/e2e/environment.mjs")).href) as EnvironmentModule;
const fixtureModule = await import(pathToFileURL(path.resolve("scripts/e2e/fixture-tap.mjs")).href) as FixtureModule;

test("E2E Tap fixture uses a bare remote and produces upgrade, invalid, and rewritten histories", async () => {
  const outputDirectory = await mkdtemp(path.join(tmpdir(), "harnessbrew-fixture-candidate-"));
  const artifact = await artifactModule.buildArtifact({ outputDirectory, allowDirty: true });
  const environment = await environmentModule.createE2EEnvironment(artifact);
  try {
    const fixture = await fixtureModule.createTapFixture(environment);
    assert.notEqual(fixture.author, fixture.remote);
    assert.equal(fixture.name, "e2e/assets");
    assert.equal(fixture.definitions.length, 10);
    assert.ok(fixture.definitions.some((definition) => definition.kind === "adapter"));
    assert.match(fixture.v1Commit, /^[a-f0-9]{40}$/u);
    await access(path.join(fixture.remote, "HEAD"));

    const clone = path.join(environment.root, "fixture-consumer");
    await execFileAsync("git", ["clone", fixture.remote, clone], { env: environment.environment, encoding: "utf8" });
    assert.match(await readFile(path.join(clone, "skills", "main-skill", "SKILL.md"), "utf8"), /v1/u);

    const v2Commit = await fixture.pushV2();
    assert.notEqual(v2Commit, fixture.v1Commit);
    const invalidCommit = await fixture.pushInvalidCandidate();
    assert.notEqual(invalidCommit, v2Commit);
    const repairedCommit = await fixture.repairInvalidCandidate();
    assert.notEqual(repairedCommit, invalidCommit);
    const rewrittenCommit = await fixture.rewriteFromV1();
    assert.notEqual(rewrittenCommit, repairedCommit);
    const remoteHead = (await execFileAsync("git", ["rev-parse", "refs/heads/main"], {
      cwd: fixture.remote,
      env: environment.environment,
      encoding: "utf8"
    })).stdout.trim();
    assert.equal(remoteHead, rewrittenCommit);
  } finally {
    await environment.cleanup();
  }
});
