import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { upgradeFixture } from "./adapter-upgrade.js";
export async function bundleFixture(t: Parameters<typeof upgradeFixture>[0]) {
  const f = await upgradeFixture(t), files: string[] = [];
  for (const name of ["one", "two"]) {
    const dir = path.join(f.root, name); await mkdir(dir);
    const file = path.join(dir, "Harnessfile.yaml");
    await writeFile(file, JSON.stringify({ format: "harnessbrew.manifest", version: 1, id: "shared", sources: [{ name: "test/assets", git: f.repository }], assets: [{ coordinate: "test/assets/a", placements: [{ target: "test-adapter", scope: "project" }] }] }));
    await f.service.execute({ kind: "bundle.apply", file }); files.push(file);
  }
  return { ...f, files };
}

