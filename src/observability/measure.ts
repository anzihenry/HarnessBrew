import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

export interface Measurement { name: string; value: number; unit: "ms" | "bytes" | "count" }
export type Observer = (event: Readonly<Measurement>) => void | Promise<void>;
const observers = new AsyncLocalStorage<Observer>();
/** Internal, operation-scoped observation. No paths, payloads or credentials. */
export function observe<T>(observer: Observer, action: () => T): T { return observers.run(observer, action); }
export function emit(name: string, value: number, unit: Measurement["unit"]): void {
  try { const result = observers.getStore()?.(Object.freeze({ name, value, unit })); void Promise.resolve(result).catch(() => undefined); }
  catch { /* Observation cannot change a business outcome. */ }
}
export async function measured<T>(name: string, action: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try { return await action(); } finally { emit(name, performance.now() - started, "ms"); }
}
