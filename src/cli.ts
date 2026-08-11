#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { HarnessBrewError } from "./core/errors.js";
import { formulaKinds, getFormula, searchFormulas, type FormulaKind } from "./core/formulas.js";
import { installFormula, listInstalled, uninstallFormula } from "./core/installations.js";
import { builtinTargets, installForTarget, linkFormula, unlinkFormula, type BuiltinTarget } from "./core/targets.js";
import { findOutdated, upgradeFormulas } from "./core/upgrades.js";
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
  search     Search formulas across registered taps
  info       Show formula metadata
  install    Install a formula and its dependencies
  list       List installed formulas
  uninstall  Safely uninstall a formula
  link       Link an installed formula to an Agent target
  unlink     Remove a managed target link
  update     Fetch all registered taps
  outdated   List installed formulas with available changes
  upgrade    Upgrade formulas while preserving target links
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

  if (command === "update") {
    const updates = await updateTaps(home);
    updates.forEach((update) => io.stdout(update.changed
      ? `Updated ${update.name}: ${update.before.slice(0, 12)} -> ${update.after.slice(0, 12)}.`
      : `${update.name} is already up-to-date.`));
    return 0;
  }

  if (command === "untap") {
    const name = args[1];
    if (name === undefined) throw new HarnessBrewError("Usage: harnessbrew untap <owner/name>");
    await removeTap(home, name);
    io.stdout(`Untapped ${name}.`);
    return 0;
  }

  if (command === "search") {
    const kindValue = optionValue(args, "--kind");
    if (kindValue !== undefined && !formulaKinds.includes(kindValue as FormulaKind)) {
      throw new HarnessBrewError(`Unsupported formula kind: ${kindValue}`);
    }
    const target = optionValue(args, "--target");
    const query = args.slice(1).find((value, index, values) => {
      if (value.startsWith("--")) return false;
      return index === 0 || !values[index - 1]?.startsWith("--");
    }) ?? "";
    const formulas = await searchFormulas(home, query, {
      ...(kindValue === undefined ? {} : { kind: kindValue as FormulaKind }),
      ...(target === undefined ? {} : { target })
    });
    formulas.forEach((formula) => io.stdout(`${formula.coordinate}\t${formula.kind}\t${formula.description}`));
    return 0;
  }

  if (command === "info") {
    const name = args[1];
    if (name === undefined) throw new HarnessBrewError("Usage: harnessbrew info <formula>");
    const formula = await getFormula(home, name);
    io.stdout(JSON.stringify({
      coordinate: formula.coordinate,
      kind: formula.kind,
      description: formula.description,
      targets: formula.targets,
      dependencies: formula.dependencies,
      commit: formula.commit,
      ...(formula.deprecated === undefined ? {} : { deprecated: formula.deprecated })
    }, null, 2));
    return 0;
  }

  if (command === "install") {
    const name = args[1];
    if (name === undefined) throw new HarnessBrewError("Usage: harnessbrew install <formula>");
    const targetValue = optionValue(args, "--target");
    if (targetValue !== undefined && !builtinTargets.includes(targetValue as BuiltinTarget)) {
      throw new HarnessBrewError(`Unsupported built-in target: ${targetValue}`);
    }
    const targetRoot = optionValue(args, "--target-root");
    const receipts = targetValue === undefined
      ? await installFormula(home, name)
      : await installForTarget(home, name, targetValue as BuiltinTarget, targetRoot === undefined ? {} : { root: targetRoot });
    receipts.forEach((receipt) => io.stdout(`Installed ${receipt.coordinate} at ${receipt.commit.slice(0, 12)}.`));
    return 0;
  }

  if (command === "list") {
    const receipts = await listInstalled(home);
    receipts.forEach((receipt) => io.stdout(`${receipt.coordinate}\t${receipt.commit.slice(0, 12)}`));
    return 0;
  }

  if (command === "uninstall") {
    const name = args[1];
    if (name === undefined) throw new HarnessBrewError("Usage: harnessbrew uninstall <formula> [--force]");
    const receipt = await uninstallFormula(home, name, { force: args.includes("--force") });
    io.stdout(`Uninstalled ${receipt.coordinate}.`);
    return 0;
  }

  if (command === "link" || command === "unlink") {
    const name = args[1];
    const targetValue = optionValue(args, "--target");
    if (name === undefined || targetValue === undefined) {
      throw new HarnessBrewError(`Usage: harnessbrew ${command} <formula> --target <target> [--target-root <path>]`);
    }
    if (!builtinTargets.includes(targetValue as BuiltinTarget)) {
      throw new HarnessBrewError(`Unsupported built-in target: ${targetValue}`);
    }
    if (command === "link") {
      await linkFormula(home, name, targetValue as BuiltinTarget, {
        ...(optionValue(args, "--target-root") === undefined ? {} : { root: optionValue(args, "--target-root") as string })
      });
      io.stdout(`Linked ${name} to ${targetValue}.`);
    } else {
      await unlinkFormula(home, name, targetValue as BuiltinTarget, args.includes("--force"));
      io.stdout(`Unlinked ${name} from ${targetValue}.`);
    }
    return 0;
  }

  if (command === "outdated") {
    const outdated = await findOutdated(home);
    outdated.forEach((item) => io.stdout(item.available
      ? `${item.coordinate}\t${item.installedCommit.slice(0, 12)} -> ${item.availableCommit?.slice(0, 12)}`
      : `${item.coordinate}\t${item.installedCommit.slice(0, 12)} -> unavailable`));
    return 0;
  }

  if (command === "upgrade") {
    const name = args[1]?.startsWith("--") === true ? undefined : args[1];
    const results = await upgradeFormulas(home, name);
    if (results.length === 0) io.stdout("All installed formulas are up-to-date.");
    results.forEach((result) => io.stdout(
      `Upgraded ${result.coordinate}: ${result.before.slice(0, 12)} -> ${result.after.slice(0, 12)}.`
    ));
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
