import path from "node:path";
import { createApplication } from "../../src/application/service.js";
const [home, project, userHome, point] = process.argv.slice(2) as [string, string, string, string];
const pause = async () => { process.send?.("ready"); await new Promise<void>(resolve => process.once("message", () => resolve())); };
const service = createApplication({ home, cwd: project, userHome }, {
  preparationCheckpoint: async () => { if (point === "after-prepare") await pause(); },
  transactionFault: async (current, context) => {
    if (current !== point) return;
    if (["after-record", "after-write"].includes(current) && context.path !== path.join(project, ".agents", "skills", "a")) return;
    await pause();
  }
});
await service.execute({ kind: "asset.install", coordinate: "a", placements: [{ target: "openai-codex", scope: "project", projectRoot: project }] });
await service.close(); process.disconnect?.();
