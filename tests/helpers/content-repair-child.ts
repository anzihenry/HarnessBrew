import path from "node:path";
import { readFile } from "node:fs/promises";
import { once } from "node:events";
import { StateStore } from "../../src/storage/state-store.js";
import { TransactionCoordinator } from "../../src/transactions/coordinator.js";
import { registryFor } from "../../src/application/adapters.js";
import { catalogAssetReader } from "../../src/ports/planning.js";

const [home, cache, id, checkpoint] = process.argv.slice(2) as [string, string, string, string];
const { saved } = JSON.parse(await readFile(path.join(cache, "plans", `${id}.json`), "utf8"));
const state = await new StateStore(home).read();
const coordinator = new TransactionCoordinator(home, { fault: async (point, context) => {
  if (point === checkpoint && (point !== "after-write" && point !== "after-record" || context.path?.includes("/content/"))) {
    process.send?.({ checkpoint }); await once(process, "message");
  }
} });
try {
  await coordinator.apply({ plan: saved.plan, catalog: saved.catalog, restorations: saved.restorations, assets: catalogAssetReader(saved.catalog), adapters: await registryFor(state, cache, []) });
} catch (error) { process.send?.({ error: (error as Error).message }); process.exitCode = 1; }
process.disconnect?.();
