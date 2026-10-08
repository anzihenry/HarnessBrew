import { HarnessError } from "../domain/errors.js";
import type { HarnessService, ChangeRequest, ReadQuery, QueryResults, AdapterUpgradeInspection } from "./types.js";
import type { RetentionPolicy } from "./retention.js";
import { runOperation, withoutCancellation, operationCommitted, type OperationOptions, type OperationPhase } from "../observability/operation.js";
/** Runtime controls never enter requests or serialized prepared changes. */
export class OperationService implements HarnessService {
  private readonly active = new Set<Promise<void>>();
  private accepting = true;
  private closing?: Promise<void>;
  constructor(private readonly service: HarnessService) {}
  private invoke<T>(options: OperationOptions | undefined, phase: OperationPhase, action: () => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new HarnessError("INVALID_ARGUMENT", "Service is closing or closed."));
    let release!: () => void;
    const ticket = new Promise<void>(resolve => { release = resolve; }); this.active.add(ticket);
    const result = runOperation(options, phase, action);
    const finish = () => { this.active.delete(ticket); release(); };
    void result.then(finish, finish); return result;
  }
  private recovery<T>(action: () => Promise<T>): Promise<T> {
    return withoutCancellation(async () => { const result = await action(); operationCommitted(); return result; });
  }
  plan(request: ChangeRequest, options?: OperationOptions) { return this.invoke(options, "prepare", () => this.service.plan(request)); }
  execute(request: ChangeRequest, options?: OperationOptions) { return this.invoke(options, "prepare", () => this.service.execute(request)); }
  apply(planId: string, options?: OperationOptions) { return this.invoke(options, "prepare", () => this.service.apply(planId)); }
  inspectAdapterUpgrade(input: { name: string; module: string }, options?: OperationOptions): Promise<AdapterUpgradeInspection> { return this.invoke(options, "prepare", () => this.service.inspectAdapterUpgrade(input)); }
  query<Q extends ReadQuery>(query: Q, options?: OperationOptions): Promise<QueryResults[Q["kind"]]> { return this.invoke(options, "prepare", () => this.service.query(query)); }
  doctor(query: { coordinate?: string } = {}, options?: OperationOptions) { return this.invoke(options, "prepare", () => this.service.doctor(query)); }
  recover(options?: OperationOptions) { return this.invoke(options, "recover", () => this.recovery(() => this.service.recover())); }
  planMaintenance(policy?: Partial<RetentionPolicy>, options?: OperationOptions) { return this.invoke(options, "maintenance", () => this.service.planMaintenance(policy)); }
  applyMaintenance(id: string, options?: OperationOptions) { return this.invoke(options, "maintenance", () => this.service.applyMaintenance(id)); }
  recoverMaintenance(options?: OperationOptions) { return this.invoke(options, "recover", () => this.recovery(() => this.service.recoverMaintenance())); }
  close(): Promise<void> {
    if (!this.closing) { this.accepting = false; this.closing = Promise.all([...this.active]).then(() => this.service.close()); }
    return this.closing;
  }
}
