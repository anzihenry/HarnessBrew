import path from "node:path";
import { HarnessBrewError } from "./core/errors.js";
import { formulaKinds, getFormula, searchFormulas, type FormulaKind } from "./core/formulas.js";
import { installFormula, listInstalled, uninstallFormula } from "./core/installations.js";
import {
  builtinTargets,
  installForTarget,
  linkFormula,
  unlinkFormula,
  type BuiltinTarget,
  type LinkOptions
} from "./core/targets.js";
import { findOutdated, upgradeFormulas } from "./core/upgrades.js";
import { bundleCleanup, bundleInstall } from "./core/bundle.js";
import { resolveHarnessHome } from "./core/paths.js";
import { addTap, listTaps, removeTap, setTapTrust, updateTaps } from "./core/taps.js";
import { VERSION } from "./version.js";
import { doctor, relinkFormula } from "./core/doctor.js";
import { withHomeLock } from "./core/locks.js";
import {
  withJournalPreview,
  withJournalTransaction,
  type TransactionChange
} from "./core/journal.js";

export interface CliIO {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface CliOptions {
  home?: string;
}

export interface CliJsonError {
  code: "COMMAND_FAILED" | "HARNESSBREW_ERROR";
  message: string;
}

export interface CliJsonEnvelope {
  schemaVersion: 1;
  ok: boolean;
  command: string;
  exitCode: number;
  dryRun: boolean;
  result: unknown;
  output: string[];
  diagnostics: string[];
  error?: CliJsonError;
  changes?: TransactionChange[];
}

interface StructuredCliIO extends CliIO {
  setResult?: (result: unknown) => void;
}

function setResult(io: CliIO, result: unknown): void {
  (io as StructuredCliIO).setResult?.(result);
}

const defaultIO: CliIO = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message)
};

const helpText = `HarnessBrew ${VERSION}

A Git-native package manager for AI Agent assets.

Usage:
  harnessbrew <command> [options] [--json] [--dry-run]

Commands:
  help       Show this help
  version    Show the installed version
  tap        Add, trust, list, update, or remove Git taps
  untap      Remove a Git tap
  search     Search formulas across registered taps
  info       Show formula metadata
  install    Install a formula and its dependencies
  list       List installed formulas
  uninstall  Safely uninstall a formula
  link       Link an installed formula to an Agent target
  unlink     Remove a managed target link
  doctor     Check Cellar and Target integrity
  relink     Rebuild managed Target installations
  update     Fetch all registered taps
  outdated   List installed formulas with available changes
  upgrade    Upgrade formulas while preserving target links
  bundle     Rebuild or clean an environment from Harnessfile

Target placement options:
  --scope <user|project>  Select user or project installation scope
  --project <path>        Project root (implies --scope project)
  --target-root <path>    Override the target's native root

Automation options:
  --json                  Emit one versioned JSON result envelope
  --dry-run               Execute a mutation transaction, report changes, then roll it back
`;

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined) throw new HarnessBrewError(`Missing value for ${name}.`);
  return value;
}

function targetOptions(args: readonly string[]): LinkOptions {
  const scopeValue = optionValue(args, "--scope");
  const projectValue = optionValue(args, "--project");
  if (scopeValue !== undefined && scopeValue !== "user" && scopeValue !== "project") {
    throw new HarnessBrewError(`Unsupported target scope: ${scopeValue}`);
  }
  if (scopeValue === "user" && projectValue !== undefined) {
    throw new HarnessBrewError("--project cannot be combined with --scope user.");
  }
  const scope = scopeValue ?? (projectValue === undefined ? "user" : "project");
  const targetRoot = optionValue(args, "--target-root");
  return {
    scope,
    ...(targetRoot === undefined ? {} : { root: targetRoot }),
    ...(scope === "project" ? { projectRoot: path.resolve(projectValue ?? process.cwd()) } : {})
  };
}

function hasTargetPlacementOptions(args: readonly string[]): boolean {
  return args.includes("--scope") || args.includes("--project") || args.includes("--target-root");
}

async function runTapCommand(args: readonly string[], home: string, io: CliIO): Promise<number> {
  const [action = "list", ...rest] = args;

  if (action === "list") {
    const taps = await listTaps(home);
    taps.forEach((tap) => io.stdout(`${tap.name}\t${tap.trusted ? "trusted" : "untrusted"}\t${tap.commit.slice(0, 12)}\t${tap.url}`));
    setResult(io, taps);
    return 0;
  }

  if (action === "add") {
    const [name, url] = rest;
    if (name === undefined || url === undefined) {
      throw new HarnessBrewError("Usage: harnessbrew tap add <owner/name> <git-url> [--ref <ref>] [--trust]");
    }
    const ref = optionValue(rest, "--ref");
    const record = await addTap(home, name, url, {
      ...(ref === undefined ? {} : { ref }),
      trust: rest.includes("--trust")
    });
    io.stdout(`Tapped ${record.name} at ${record.commit.slice(0, 12)}.`);
    setResult(io, record);
    return 0;
  }

  if (action === "update") {
    const requested = rest.find((value) => !value.startsWith("--"));
    const updates = await updateTaps(home, requested, { allowRewind: rest.includes("--allow-rewind") });
    updates.forEach((update) => {
      io.stdout(update.changed
        ? `Updated ${update.name}: ${update.before.slice(0, 12)} -> ${update.after.slice(0, 12)}.`
        : `${update.name} is already up-to-date.`);
    });
    setResult(io, updates);
    return 0;
  }

  if (action === "remove") {
    const [name] = rest;
    if (name === undefined) throw new HarnessBrewError("Usage: harnessbrew tap remove <owner/name>");
    const record = await removeTap(home, name);
    io.stdout(`Untapped ${name}.`);
    setResult(io, record);
    return 0;
  }

  if (action === "trust" || action === "untrust") {
    const [name] = rest;
    if (name === undefined) throw new HarnessBrewError(`Usage: harnessbrew tap ${action} <owner/name>`);
    const record = await setTapTrust(home, name, action === "trust");
    io.stdout(`${record.name} is now ${record.trusted ? "trusted" : "untrusted"}.`);
    setResult(io, record);
    return 0;
  }

  throw new HarnessBrewError(`Unknown tap action: ${action}`);
}

async function execute(args: readonly string[], io: CliIO, options: CliOptions): Promise<number> {
  const [command] = args;

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    io.stdout(helpText.trimEnd());
    setResult(io, { help: helpText.trimEnd() });
    return 0;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    io.stdout(VERSION);
    setResult(io, { version: VERSION });
    return 0;
  }

  const home = resolveHarnessHome(options.home);
  if (command === "tap") {
    return runTapCommand(args.slice(1), home, io);
  }

  if (command === "update") {
    const updates = await updateTaps(home, undefined, { allowRewind: args.includes("--allow-rewind") });
    updates.forEach((update) => io.stdout(update.changed
      ? `Updated ${update.name}: ${update.before.slice(0, 12)} -> ${update.after.slice(0, 12)}.`
      : `${update.name} is already up-to-date.`));
    setResult(io, updates);
    return 0;
  }

  if (command === "untap") {
    const name = args[1];
    if (name === undefined) throw new HarnessBrewError("Usage: harnessbrew untap <owner/name>");
    const record = await removeTap(home, name);
    io.stdout(`Untapped ${name}.`);
    setResult(io, record);
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
    setResult(io, formulas);
    return 0;
  }

  if (command === "info") {
    const name = args[1];
    if (name === undefined) throw new HarnessBrewError("Usage: harnessbrew info <formula>");
    const formula = await getFormula(home, name);
    const result = {
      coordinate: formula.coordinate,
      kind: formula.kind,
      description: formula.description,
      targets: formula.targets,
      dependencies: formula.dependencies,
      commit: formula.commit,
      ...(formula.deprecated === undefined ? {} : { deprecated: formula.deprecated })
    };
    io.stdout(JSON.stringify(result, null, 2));
    setResult(io, result);
    return 0;
  }

  if (command === "install") {
    const name = args[1];
    if (name === undefined) throw new HarnessBrewError("Usage: harnessbrew install <formula>");
    const targetValue = optionValue(args, "--target");
    if (targetValue !== undefined && !builtinTargets.includes(targetValue as BuiltinTarget)) {
      throw new HarnessBrewError(`Unsupported built-in target: ${targetValue}`);
    }
    const receipts = targetValue === undefined
      ? await installFormula(home, name)
      : await installForTarget(home, name, targetValue as BuiltinTarget, targetOptions(args));
    receipts.forEach((receipt) => io.stdout(`Installed ${receipt.coordinate} at ${receipt.commit.slice(0, 12)}.`));
    setResult(io, receipts);
    return 0;
  }

  if (command === "list") {
    const receipts = await listInstalled(home);
    receipts.forEach((receipt) => io.stdout(`${receipt.coordinate}\t${receipt.commit.slice(0, 12)}`));
    setResult(io, receipts);
    return 0;
  }

  if (command === "uninstall") {
    const name = args[1];
    if (name === undefined) throw new HarnessBrewError("Usage: harnessbrew uninstall <formula> [--force]");
    const receipt = await uninstallFormula(home, name, { force: args.includes("--force") });
    io.stdout(`Uninstalled ${receipt.coordinate}.`);
    setResult(io, receipt);
    return 0;
  }

  if (command === "link" || command === "unlink") {
    const name = args[1];
    const targetValue = optionValue(args, "--target");
    if (name === undefined || targetValue === undefined) {
      throw new HarnessBrewError(
        `Usage: harnessbrew ${command} <formula> --target <target> [--scope <user|project>] [--project <path>]`
      );
    }
    if (!builtinTargets.includes(targetValue as BuiltinTarget)) {
      throw new HarnessBrewError(`Unsupported built-in target: ${targetValue}`);
    }
    if (command === "link") {
      const receipt = await linkFormula(home, name, targetValue as BuiltinTarget, targetOptions(args));
      io.stdout(`Linked ${name} to ${targetValue}.`);
      setResult(io, receipt);
    } else {
      const receipt = await unlinkFormula(home, name, targetValue as BuiltinTarget, {
        ...(hasTargetPlacementOptions(args) ? targetOptions(args) : {}),
        force: args.includes("--force")
      });
      io.stdout(`Unlinked ${name} from ${targetValue}.`);
      setResult(io, receipt);
    }
    return 0;
  }

  if (command === "doctor") {
    const name = args[1]?.startsWith("--") === true ? undefined : args[1];
    const report = await doctor(home, name);
    setResult(io, report);
    if (report.healthy) {
      io.stdout(`Doctor found no issues across ${report.checked} formula(s).`);
      return 0;
    }
    report.findings.forEach((finding) => io.stderr([
      finding.coordinate,
      finding.kind,
      finding.target,
      finding.destination
    ].filter((value) => value !== undefined).join("\t")));
    return 1;
  }

  if (command === "relink") {
    const name = args[1];
    if (name === undefined) throw new HarnessBrewError("Usage: harnessbrew relink <formula> [--target <target>]");
    const targetValue = optionValue(args, "--target");
    if (targetValue !== undefined && !builtinTargets.includes(targetValue as BuiltinTarget)) {
      throw new HarnessBrewError(`Unsupported built-in target: ${targetValue}`);
    }
    const receipt = await relinkFormula(home, name, {
      ...(hasTargetPlacementOptions(args) ? targetOptions(args) : {}),
      ...(targetValue === undefined ? {} : { target: targetValue as BuiltinTarget })
    });
    io.stdout(`Relinked ${name}${targetValue === undefined ? "" : ` to ${targetValue}`}.`);
    setResult(io, receipt);
    return 0;
  }

  if (command === "outdated") {
    const outdated = await findOutdated(home);
    outdated.forEach((item) => io.stdout(item.available
      ? `${item.coordinate}\t${item.installedCommit.slice(0, 12)} -> ${item.availableCommit?.slice(0, 12)}`
      : `${item.coordinate}\t${item.installedCommit.slice(0, 12)} -> unavailable`));
    setResult(io, outdated);
    return 0;
  }

  if (command === "upgrade") {
    const name = args[1]?.startsWith("--") === true ? undefined : args[1];
    const results = await upgradeFormulas(home, name);
    if (results.length === 0) io.stdout("All installed formulas are up-to-date.");
    results.forEach((result) => io.stdout(
      `Upgraded ${result.coordinate}: ${result.before.slice(0, 12)} -> ${result.after.slice(0, 12)}.`
    ));
    setResult(io, results);
    return 0;
  }

  if (command === "bundle") {
    const action = args[1];
    const filePath = optionValue(args, "--file") ?? path.resolve("Harnessfile");
    if (action === "install") {
      const lock = await bundleInstall(home, filePath, { updateLock: args.includes("--update-lock") });
      io.stdout(`Bundle installed ${lock.assets.length} formulas from ${lock.taps.length} taps.`);
      setResult(io, lock);
      return 0;
    }
    if (action === "cleanup") {
      const result = await bundleCleanup(home, filePath);
      result.removed.forEach((coordinate) => io.stdout(`Removed ${coordinate}.`));
      setResult(io, result);
      return 0;
    }
    throw new HarnessBrewError("Usage: harnessbrew bundle <install|cleanup> [--file <Harnessfile>] [--update-lock]");
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
  const json = args.includes("--json");
  const dryRun = args.includes("--dry-run");
  const commandArgs = args.filter((argument) => argument !== "--json" && argument !== "--dry-run");
  const output: string[] = [];
  const diagnostics: string[] = [];
  let result: unknown = null;
  const commandIO: StructuredCliIO = json || dryRun
    ? {
      stdout: (message) => output.push(message),
      stderr: (message) => diagnostics.push(message),
      setResult: (value: unknown) => { result = value; }
    }
    : io;
  const command = commandArgs[0];
  const tapAction = command === "tap" ? (commandArgs[1] ?? "list") : undefined;
  const mutates = command === "update" || command === "untap" || command === "install"
    || command === "uninstall" || command === "link" || command === "unlink" || command === "relink"
    || command === "upgrade" || command === "bundle"
    || (command === "tap" && tapAction !== "list");
  const emitJson = (exitCode: number, changes: TransactionChange[] = [], errorCode?: CliJsonError["code"]): void => {
    const envelope: CliJsonEnvelope = {
      schemaVersion: 1,
      ok: exitCode === 0,
      command: command ?? "help",
      exitCode,
      dryRun,
      result,
      output,
      diagnostics,
      ...(exitCode === 0 ? {} : {
        error: {
          code: errorCode ?? "COMMAND_FAILED",
          message: diagnostics[0] ?? "Command failed."
        }
      }),
      ...(dryRun ? { changes } : {})
    };
    io.stdout(JSON.stringify(envelope));
  };
  try {
    const home = resolveHarnessHome(options.home);
    if (dryRun && !mutates) throw new HarnessBrewError("--dry-run requires a mutating command.");
    let exitCode: number;
    let changes: TransactionChange[] = [];
    if (dryRun) {
      const preview = await withHomeLock(home, () => withJournalPreview(
        home,
        `preview:${command ?? "unknown"}`,
        () => execute(commandArgs, commandIO, options)
      ));
      exitCode = preview.result;
      changes = preview.changes;
      if (!json) {
        io.stdout(`Dry run completed: ${changes.length} path change(s) would be made.`);
        changes.forEach((change) => io.stdout(
          `${change.before.kind === "missing" ? "create" : change.after.kind === "missing" ? "remove" : "modify"}\t${change.path}`
        ));
      }
    } else {
      exitCode = mutates
        ? await withHomeLock(home, () => withJournalTransaction(
          home,
          `cli:${command ?? "unknown"}`,
          () => execute(commandArgs, commandIO, options)
        ))
        : await execute(commandArgs, commandIO, options);
    }
    if (json) emitJson(exitCode, changes);
    return exitCode;
  } catch (error) {
    if (error instanceof HarnessBrewError) {
      if (json) {
        diagnostics.push(error.message);
        emitJson(1, [], "HARNESSBREW_ERROR");
      } else io.stderr(error.message);
      return 1;
    }
    throw error;
  }
}
