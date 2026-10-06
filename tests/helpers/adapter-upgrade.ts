import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TestContext } from "node:test";
import { applicationFixture } from "./application.js";
export async function upgradeFixture(t: TestContext) {
  const f = await applicationFixture(t);
  const plugin = async (version: string, folder: string, preamble = "") => {
    const module = path.join(f.root, `plugin-${version}`); await mkdir(module, { recursive: true });
    await writeFile(path.join(module, "package.json"), JSON.stringify({ type: "module", harnessbrew: { format: "harnessbrew.adapter-package", version: 1, name: "test-adapter", adapterVersion: version, entry: "index.js" } }));
    await writeFile(path.join(module, "index.js"), `import path from 'node:path'; ${preamble}
export default {protocol:'harnessbrew.adapter/1',name:'test-adapter',version:${JSON.stringify(version)},supportedKinds:['skill'],requiredCapabilities:['link-directory'],async plan(asset,target){return {operations:[{type:'link-directory',sourceRelativePath:'.',resource:{kind:'path',path:path.join(target.roots.skills,${JSON.stringify(folder)},asset.manifest.coordinate.split('/')[2]),pathType:'directory'}}]}}};`);
    return module;
  };
  const old = await plugin("1", "old"), next = await plugin("2", "next");
  await f.add("a", { targets: ["test-adapter", "openai-codex"] }); await f.register();
  await f.service.execute({ kind: "adapter.add", module: old, capabilities: ["link-directory"] });
  const placement = { ...f.placement, target: "test-adapter" };
  await f.service.execute({ kind: "asset.install", coordinate: "a", placements: [placement] });
  const request = async () => ({ kind: "adapter.upgrade" as const, name: "test-adapter", module: next, authorizedSignature: (await f.service.inspectAdapterUpgrade({ name: "test-adapter", module: next })).candidate.signature, capabilities: ["link-directory" as const] });
  return { ...f, plugin, old, next, placement, request };
}
