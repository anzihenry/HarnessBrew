#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { HarnessBrewError } from "./core/errors.js";
import { resolveHarnessHome } from "./core/paths.js";
import { addTap, listTaps, removeTap, updateTaps } from "./core/taps.js";
import { VERSION } from "./version.js";

export interface CliIO {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface CliOptions {
  home?: string;
}

const defaultIO: CliIO = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message)
};

const helpText = `HarnessBrew ${VERSION}

A Git-native package manager for AI Agent assets.

Usage:
  harnessbrew <command> [options]

Commands:
  help       Show this help
  version    Show the installed version
  tap        Add, list, update, or remove Git taps
  untap      Remove a Git tap
`;

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined) throw new HarnessBrewError(`Missing value for ${name}.`);
  return value;
}

async function runTapCommand(args: readonly string[], home: string, io: CliIO): Promise<number> {
  const [action = "list", ...rest] = args;

  if (action === "list") {
    const taps = await listTaps(home);
    taps.forEach((tap) => io.stdout(`${tap.name}\t${tap.commit.slice(0, 12)}\t${tap.url}`));
    return 0;
  }

  if (action === "add") {
    const [name, url] = rest;
    if (name === undefined || url === undefined) {
      throw new HarnessBrewError("Usage: harnessbrew tap add <owner/name> <git-url> [--ref <ref>]");
    }
    const ref = optionValue(rest, "--ref");
    const record = await addTap(home, name, url, ref === undefined ? {} : { ref });
    io.stdout(`Tapped ${record.name} at ${record.commit.slice(0, 12)}.`);
    return 0;
  }

  if (action === "update") {
    const updates = await updateTaps(home, rest[0]);
    updates.forEach((update) => {
      io.stdout(update.changed
        ? `Updated ${update.name}: ${update.before.slice(0, 12)} -> ${update.after.slice(0, 12)}.`
        : `${update.name} is already up-to-date.`);
    });
    return 0;
  }

  if (action === "remove") {
    const [name] = rest;
    if (name === undefined) throw new HarnessBrewError("Usage: harnessbrew tap remove <owner/name>");
    await removeTap(home, name);
    io.stdout(`Untapped ${name}.`);
    return 0;
  }

  throw new HarnessBrewError(`Unknown tap action: ${action}`);
}

async function execute(args: readonly string[], io: CliIO, options: CliOptions): Promise<number> {
  const [command] = args;

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    io.stdout(helpText.trimEnd());
    return 0;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    io.stdout(VERSION);
    return 0;
  }

  const home = resolveHarnessHome(options.home);
  if (command === "tap") {
    return runTapCommand(args.slice(1), home, io);
  }

  if (command === "untap") {
    const name = args[1];
    if (name === undefined) throw new HarnessBrewError("Usage: harnessbrew untap <owner/name>");
    await removeTap(home, name);
    io.stdout(`Untapped ${name}.`);
    return 0;
  }

  io.stderr(`Unknown command: ${command}`);
  io.stderr("Run 'harnessbrew help' for usage.");
  return 1;
}

export async function runCli(
  args: readonly string[],
  io: CliIO = defaultIO,
  options: CliOptions = {}
): Promise<number> {
  try {
    return await execute(args, io, options);
  } catch (error) {
    if (error instanceof HarnessBrewError) {
      io.stderr(error.message);
      return 1;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  process.exitCode = await runCli(process.argv.slice(2));
}

const entryUrl = process.argv[1] === undefined ? undefined : pathToFileURL(process.argv[1]).href;
if (entryUrl === import.meta.url) {
  await main();
}
