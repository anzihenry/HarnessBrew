import { readFile } from "node:fs/promises";
import path from "node:path";
import { TransactionCoordinator, type TransactionCheckpoint } from "../../src/transactions/coordinator.js";
import { build } from "./execution.js";
import type { CatalogSnapshot } from "../../src/domain/catalog.js";
import type { ResolutionRequest } from "../../src/domain/resolution.js";
const [root, checkpoint, suffix = ""] = process.argv.slice(2);
if (!root || !process.send) throw new Error("Expected fixture root and IPC");
const input = JSON.parse(await readFile(path.join(root, "fixture.json"), "utf8")) as { home: string; lockRoot: string; catalog: CatalogSnapshot; request: ResolutionRequest };
const coordinator = new TransactionCoordinator(input.home, { lockRoot: input.lockRoot, async fault(point, context) {
  if (point === checkpoint as TransactionCheckpoint && (!suffix || context.path?.endsWith(suffix))) {
    process.send?.({ checkpoint: point });
    await new Promise<void>(resolve => process.once("message", () => resolve()));
  }
} });
await coordinator.execute(state => build(input.home, state, input.catalog, input.request));
process.send?.({ completed: true }); process.disconnect();
