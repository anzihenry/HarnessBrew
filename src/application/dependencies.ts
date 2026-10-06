import { readFile } from "node:fs/promises";
import { SourceManager } from "../sources/manager.js";
import { nodeStorageIO, type StorageIO } from "../ports/io.js";
import { nodePlanningIO } from "../ports/planning.js";
import type { PlanningIO } from "../domain/plan.js";
import { atomicDocument } from "../execution/files.js";
import type { TransactionFault } from "../transactions/coordinator.js";

export type SourcePreparation = Pick<SourceManager, "prepare" | "prepareSelection">;
export interface PlanDocumentIO {
  read(file: string): Promise<string>;
  write(file: string, value: unknown): Promise<void>;
}
/** Internal composition seam; not part of the public SDK exports. */
export interface ApplicationDependencies {
  sources(root: string): SourcePreparation;
  planning: PlanningIO;
  storage: StorageIO;
  documents: PlanDocumentIO;
  transactionFault: TransactionFault;
  preparationCheckpoint(): void | Promise<void>;
}
export const nodeApplicationDependencies: ApplicationDependencies = {
  sources: root => new SourceManager(root), planning: nodePlanningIO, storage: nodeStorageIO,
  documents: { read: file => readFile(file, "utf8"), write: atomicDocument },
  preparationCheckpoint: () => undefined, transactionFault: () => undefined
};
