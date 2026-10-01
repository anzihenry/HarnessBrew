import { HarnessError } from "./errors.js";

export function invalid(context: string): never {
  throw new HarnessError("INVALID_STATE", `Invalid ${context}.`, { context });
}
export function record(value: unknown, context: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value) as object | null)) invalid(context);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key))) invalid(`${context}: unknown field`);
  return result;
}
export function text(value: unknown, context: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0")) invalid(context);
  return value;
}
export function array<T>(value: unknown, context: string, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value)) invalid(context);
  return Array.from(value, parse);
}
export function oneOf<const T extends readonly string[]>(value: unknown, values: T, context: string): T[number] {
  if (typeof value !== "string" || !values.includes(value)) invalid(context);
  return value as T[number];
}
export function unique<T>(items: T[], key: (item: T) => string, context: string): T[] {
  if (new Set(items.map(key)).size !== items.length) invalid(`${context}: duplicate`);
  return items;
}
export function format(value: unknown, name: string, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== "object" || value === null
    || (value as { format?: unknown }).format !== name || (value as { version?: unknown }).version !== 1) {
    throw new HarnessError("UNSUPPORTED_FORMAT", `Expected ${name} version 1.`, { format: name });
  }
  return record(value, name, ["format", "version", ...keys]);
}
export function canonicalJson(value: unknown): string {
  function normalize(item: unknown): unknown {
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(normalize);
    if (typeof item === "object" && item !== null) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, child]) => [key, normalize(child)]));
    }
    return invalid("JSON value");
  }
  return JSON.stringify(normalize(value));
}

export function sortBy<T>(items: T[], key: (item: T) => string): T[] {
  return items.sort((left, right) => key(left) < key(right) ? -1 : key(left) > key(right) ? 1 : 0);
}
