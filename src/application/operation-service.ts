import type { HarnessService, ChangeRequest, ReadQuery, QueryResults, AdapterUpgradeInspection } from "./types.js";
import type { RetentionPolicy } from "./retention.js";
import { runOperation, type OperationOptions } from "../observability/operation.js";
/** Runtime controls never enter requests or serialized prepared changes. */
export class OperationService implements HarnessService {
  constructor(private readonly service: HarnessService) {}
  plan(request: ChangeRequest, options?: OperationOptions) { return runOperation(options, "prepare", () => this.service.plan(request)); }
  execute(request: ChangeRequest, options?: OperationOptions) { return runOperation(options, "prepare", () => this.service.execute(request)); }
  apply(planId: string, options?: OperationOptions) { return runOperation(options, "prepare", () => this.service.apply(planId)); }
  inspectAdapterUpgrade(input: { name: string; module: string }, options?: OperationOptions): Promise<AdapterUpgradeInspection> { return runOperation(options, "prepare", () => this.service.inspectAdapterUpgrade(input)); }
  query<Q extends ReadQuery>(query: Q, options?: OperationOptions): Promise<QueryResults[Q["kind"]]> { return runOperation(options, "prepare", () => this.service.query(query)); }
  doctor(query: { coordinate?: string } = {}, options?: OperationOptions) { return runOperation(options, "prepare", () => this.service.doctor(query)); }
  recover(options?: OperationOptions) { return runOperation(options, "recover", () => this.service.recover()); }
  planMaintenance(policy?: Partial<RetentionPolicy>, options?: OperationOptions) { return runOperation(options, "maintenance", () => this.service.planMaintenance(policy)); }
  applyMaintenance(id: string, options?: OperationOptions) { return runOperation(options, "maintenance", () => this.service.applyMaintenance(id)); }
  recoverMaintenance(options?: OperationOptions) { return runOperation(options, "recover", () => this.service.recoverMaintenance()); }
  close() { return this.service.close(); }
}
