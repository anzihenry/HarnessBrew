import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface TestArtifact {
  packagePath: string;
  manifestPath: string;
  checksumsPath: string;
  manifest: {
    package: { name: string; version: string; filename: string; sha256: string };
    source: { commit: string; tag: string; dirty: boolean };
  };
}
/** Every test receives a private copy so tampering tests cannot corrupt the shared candidate. */
export async function buildTestArtifact(options: { outputDirectory: string; allowDirty?: boolean }): Promise<TestArtifact> {
  const shared = process.env.HARNESSBREW_TEST_CANDIDATE;
  if (shared === undefined) {
    const builder = await import(pathToFileURL(path.resolve("scripts/artifact/build.mjs")).href) as {
      buildArtifact(options: { outputDirectory: string; allowDirty?: boolean }): Promise<TestArtifact>;
    };
    return builder.buildArtifact(options);
  }
  const manifest = JSON.parse(await readFile(path.join(shared, "artifact-manifest.json"), "utf8")) as TestArtifact["manifest"];
  if (path.basename(manifest.package.filename) !== manifest.package.filename) throw new Error("Invalid candidate filename");
  const output = path.resolve(options.outputDirectory);
  await mkdir(output, { recursive: true });
  const names = [manifest.package.filename, "artifact-manifest.json", "SHA256SUMS"];
  await Promise.all(names.map(name => copyFile(path.join(shared, name), path.join(output, name))));
  return { packagePath: path.join(output, manifest.package.filename), manifestPath: path.join(output, "artifact-manifest.json"),
    checksumsPath: path.join(output, "SHA256SUMS"), manifest };
}
