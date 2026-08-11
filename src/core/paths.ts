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
