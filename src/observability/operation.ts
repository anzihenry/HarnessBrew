import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { HarnessError } from "../domain/errors.js";
export type OperationPhase = "prepare" | "lock-wait" | "apply" | "recover" | "maintenance" | "complete";
export interface ProgressEvent { phase: OperationPhase; completed?: number; total?: number }
export interface OperationOptions { signal?: AbortSignal; timeoutMs?: number; onProgress?: (event: Readonly<ProgressEvent>) => void | Promise<void> }
interface Context { completion: { durable: boolean }; signal: AbortSignal; deadline?: number; onProgress?: OperationOptions["onProgress"]; phase: OperationPhase; protected: boolean; timedOut: boolean }
const contexts = new AsyncLocalStorage<Context>();
export function progress(phase: OperationPhase, completed?: number, total?: number): void {
  const context = contexts.getStore(); if (!context) return; context.phase = phase;
  const event = Object.freeze({ phase, ...(completed === undefined ? {} : { completed }), ...(total === undefined ? {} : { total }) });
  try { void Promise.resolve(context.onProgress?.(event)).catch(() => undefined); } catch { /* Callbacks cannot change outcomes. */ }
}
export function operationCheckpoint(): void {
  const context = contexts.getStore(); if (!context || context.protected || context.completion.durable) return;
  if (context.deadline !== undefined && performance.now() >= context.deadline) context.timedOut = true;
  if (context.timedOut) throw new HarnessError("OPERATION_TIMEOUT", "Operation deadline exceeded.", { phase: context.phase, committed: false });
  if (context.signal.aborted) throw new HarnessError("OPERATION_ABORTED", "Operation aborted.", { phase: context.phase, committed: false });
}
export function operationSignal(): AbortSignal | undefined { const c = contexts.getStore(); return c?.protected || c?.completion.durable ? undefined : c?.signal; }
/** Only a durable business commit or completed explicit recovery can seal an operation. */
export function operationCommitted(): void { const c = contexts.getStore(); if (c) c.completion.durable = true; }
export function withoutCancellation<T>(action: () => T): T { const c = contexts.getStore(); return c ? contexts.run({ ...c, protected: true }, action) : action(); }
export async function runOperation<T>(options: OperationOptions | undefined, phase: OperationPhase, action: () => Promise<T>): Promise<T> {
  const started = performance.now(), value = options === undefined ? {} : options;
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !["signal", "timeoutMs", "onProgress"].includes(k)) || value.signal !== undefined && !(value.signal instanceof AbortSignal) || value.timeoutMs !== undefined && (!Number.isSafeInteger(value.timeoutMs) || value.timeoutMs < 0 || value.timeoutMs > 2147483647) || value.onProgress !== undefined && typeof value.onProgress !== "function") throw new HarnessError("INVALID_ARGUMENT", "Invalid operation options.");
  const controller = new AbortController();
  const context: Context = { completion: { durable: false }, signal: controller.signal, ...(value.timeoutMs === undefined ? {} : { deadline: started + value.timeoutMs }), ...(value.onProgress ? { onProgress: value.onProgress } : {}), phase, protected: false, timedOut: false };
  const abort = () => controller.abort(); value.signal?.addEventListener("abort", abort, { once: true }); if (value.signal?.aborted) abort();
  const timer = value.timeoutMs === undefined ? undefined : setTimeout(() => { context.timedOut = true; controller.abort(); }, value.timeoutMs); timer?.unref();
  try { return await contexts.run(context, async () => { operationCheckpoint(); progress(phase); operationCheckpoint(); const result = await action(); operationCheckpoint(); progress("complete"); return result; }); }
  finally { if (timer) clearTimeout(timer); value.signal?.removeEventListener("abort", abort); }
}
