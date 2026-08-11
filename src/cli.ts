#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { VERSION } from "./version.js";

export interface CliIO {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
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
`;

export async function runCli(args: readonly string[], io: CliIO = defaultIO): Promise<number> {
  const [command] = args;

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    io.stdout(helpText.trimEnd());
    return 0;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    io.stdout(VERSION);
    return 0;
  }

  io.stderr(`Unknown command: ${command}`);
  io.stderr("Run 'harnessbrew help' for usage.");
  return 1;
}

async function main(): Promise<void> {
  process.exitCode = await runCli(process.argv.slice(2));
}

const entryUrl = process.argv[1] === undefined ? undefined : pathToFileURL(process.argv[1]).href;
if (entryUrl === import.meta.url) {
  await main();
}
