import { homedir } from "node:os";
import path from "node:path";
import { HarnessBrewError } from "./errors.js";

const tapNamePattern = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;

export function resolveHarnessHome(override?: string): string {
  return path.resolve(override ?? process.env.HARNESSBREW_HOME ?? path.join(homedir(), ".harnessbrew"));
}

export function assertTapName(name: string): void {
  if (!tapNamePattern.test(name)) {
    throw new HarnessBrewError(`Invalid tap name: ${name}. Expected <owner>/<name>.`);
  }
}

export function resolveTapPath(home: string, name: string): string {
  assertTapName(name);
  const [owner, tap] = name.split("/") as [string, string];
  return path.join(home, "taps", owner, tap);
}

export function resolveStatePath(home: string): string {
  return path.join(home, "state.json");
}

export function resolveAdapterPluginsPath(home: string): string {
  return path.join(home, "adapters.json");
}

export function parseCoordinate(coordinate: string): [string, string, string] {
  const parts = coordinate.split("/");
  if (parts.length !== 3 || parts.some((part) => !/^[a-z0-9][a-z0-9-]*$/u.test(part))) {
    throw new HarnessBrewError(`Invalid formula coordinate: ${coordinate}`);
  }
  return parts as [string, string, string];
}

export function resolveCellarPath(home: string, coordinate: string, commit: string): string {
  const [owner, tap, formula] = parseCoordinate(coordinate);
  if (!/^[0-9a-f]{40}$/u.test(commit)) {
    throw new HarnessBrewError(`Invalid Git commit for ${coordinate}: ${commit}`);
  }
  return path.join(home, "cellar", owner, tap, formula, commit);
}

export function resolveReceiptPath(home: string, coordinate: string): string {
  const [owner, tap, formula] = parseCoordinate(coordinate);
  return path.join(home, "receipts", owner, tap, `${formula}.json`);
}
