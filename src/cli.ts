import path from "node:path";
import os from "node:os";
import { createHarness } from "./application/service.js";
import type { ChangeRequest } from "./application/types.js";
import { HarnessError } from "./domain/errors.js";
import { resolveAsset } from "./domain/identity.js";
import type { Placement } from "./domain/placement.js";
import type { AppliedOperationType } from "./domain/state.js";
import { VERSION } from "./version.js";
export interface CliIO { stdout(message: string): void; stderr(message: string): void }
export interface CliOptions { home?: string; cwd?: string; userHome?: string }
export interface CliJsonError { code: string; message: string; details: Readonly<Record<string, unknown>>; recovery?: unknown }
export interface CliJsonEnvelope { format: "harnessbrew.result"; version: 1; ok: boolean; command: string; mode: "query" | "preview" | "execute" | "recover"; result?: unknown; diagnostics: string[]; error?: CliJsonError }
const help = `HarnessBrew — Git-native package manager for AI Agent assets\nCommands: tap add|update|remove|trust|untrust|list, adapter add|remove|list,\ninstall, upgrade, remove, link, unlink, bundle apply|detach, cleanup, repair,\nrecover, doctor, list, search, info, outdated, apply-plan.\nGlobal: --home <path> --json. Changes: --dry-run.\nPlacement: --target <name> --scope user|project --project <path> --root <path>.\nBundle: apply --file <path> [--update-lock]; detach --binding <id>.`;
const values = new Set(["home", "target", "scope", "project", "root", "file", "binding", "ref", "capabilities"]);
const flags = new Set(["json", "dry-run", "update-lock", "allow-rewind", "overwrite-owned", "help", "version"]);
function invalid(message: string): never { throw new HarnessError("INVALID_ARGUMENT", message); }
export async function runCli(argv: string[], io: CliIO = { stdout: message => process.stdout.write(message), stderr: message => process.stderr.write(message) }, options: CliOptions = {}): Promise<number> {
  const json = argv.includes("--json"), positional: string[] = [], opts = new Map<string, string | true>();
  let command = "", mode: CliJsonEnvelope["mode"] = "query", service: ReturnType<typeof createHarness> | undefined;
  const output = (envelope: CliJsonEnvelope, code: number): number => {
    if (json) io.stdout(`${JSON.stringify(envelope)}\n`);
    else if (envelope.ok) io.stdout(`${typeof envelope.result === "string" ? envelope.result : JSON.stringify(envelope.result, null, 2)}\n`);
    else if (envelope.error) io.stderr(`${envelope.error.code}: ${envelope.error.message}\n`);
    else io.stdout(`${JSON.stringify(envelope.result, null, 2)}\n`);
    return code;
  };
  try {
    for (let i = 0; i < argv.length; i++) {
      const token = argv[i]!;
      if (!token.startsWith("-")) { positional.push(token); continue; }
      if (!token.startsWith("--")) invalid(`Unknown option: ${token}`);
      const key = token.slice(2);
      if ((!values.has(key) && !flags.has(key)) || opts.has(key)) invalid(`Unknown or repeated option: ${token}`);
      if (values.has(key)) { const value = argv[++i]; if (!value || value.startsWith("--")) invalid(`Missing value: ${token}`); opts.set(key, value); }
      else opts.set(key, true);
    }
    command = positional.shift() ?? (opts.has("version") ? "version" : "help");
    if (opts.has("help")) command = "help";
    const sub = ["tap", "adapter", "bundle"].includes(command) ? positional.shift() : undefined;
    const name = sub ? `${command}.${sub}` : command;
    const allowed: Record<string, string[]> = {
      "tap.add": ["ref"], "tap.update": ["ref", "allow-rewind"], "tap.remove": [], "tap.trust": [], "tap.untrust": [], "tap.list": [],
      "adapter.add": ["capabilities"], "adapter.remove": [], "adapter.list": [],
      install: ["target", "scope", "project", "root"], upgrade: [], remove: [], link: ["target", "scope", "project", "root"], unlink: ["target", "scope", "project", "root"],
      "bundle.apply": ["file", "update-lock"], "bundle.detach": ["binding"], repair: ["target", "scope", "project", "root", "overwrite-owned"], cleanup: [], recover: [], doctor: [], list: [], search: [], info: [], outdated: [], "apply-plan": [], help: [], version: []
    };
    if (!Object.hasOwn(allowed, name)) invalid(`Unknown command: ${name}`);
    const readonly = ["tap.list", "adapter.list", "doctor", "list", "search", "info", "outdated", "help", "version"].includes(name);
    for (const key of opts.keys()) if (!["home", "json", "help", ...(name === "version" || name === "help" ? ["version"] : []), ...(!readonly && name !== "recover" && name !== "apply-plan" ? ["dry-run"] : []), ...allowed[name]!].includes(key)) invalid(`Option --${key} is not valid for ${name}`);
    const arg = (count: number, optional = false) => { if (positional.length > count || positional.length < count - (optional ? 1 : 0)) invalid(`Invalid arguments for ${name}`); return positional[0]!; };
    const value = (key: string) => typeof opts.get(key) === "string" ? opts.get(key) as string : undefined;
    const cwd = path.resolve(options.cwd ?? process.cwd()), userHome = path.resolve(options.userHome ?? os.homedir());
    const placement = (): Placement => {
      const scope = value("scope") ?? "user";
      if (scope !== "user" && scope !== "project") invalid("--scope must be user or project");
      if (scope === "user" && opts.has("project")) invalid("--project requires --scope project");
      return { target: value("target") ?? "openai-codex", scope, ...(scope === "project" ? { projectRoot: path.resolve(cwd, value("project") ?? ".") } : {}), ...(value("root") ? { rootOverride: path.resolve(cwd, value("root")!) } : {}) };
    };
    const envelope = (result: unknown, ok = true): CliJsonEnvelope => ({ format: "harnessbrew.result", version: 1, ok, command: sub ? `${command} ${sub}` : command, mode, result, diagnostics: [] });
    if (name === "help" || name === "version") { arg(0); return output(envelope(name === "help" ? help : VERSION), 0); }
    service = createHarness({ home: path.resolve(cwd, value("home") ?? options.home ?? process.env.HARNESSBREW_HOME ?? path.join(userHome, ".harnessbrew")), cwd, userHome });
    if (name === "recover") { arg(0); mode = "recover"; return output(envelope(await service.recover()), 0); }
    if (name === "apply-plan") { const id = arg(1); mode = "execute"; return output(envelope(await service.apply(id)), 0); }
    if (name === "doctor") { const coordinate = arg(1, true); const report = await service.doctor(coordinate ? { coordinate } : {}); return output(envelope(report, report.healthy), report.healthy ? 0 : report.findings.some(f => f.code.startsWith("RECOVERY_")) ? 3 : 1); }
    if (readonly) {
      const kind = name === "tap.list" ? "taps" : name === "adapter.list" ? "adapters" : name;
      const query = kind === "info" ? { kind: "info" as const, coordinate: arg(1) } : kind === "search" ? { kind: "search" as const, ...(arg(1, true) ? { text: positional[0]! } : {}) } : (arg(0), { kind: kind as "list" | "taps" | "adapters" | "outdated" });
      return output(envelope(await service.query(query)), 0);
    }
    let request: ChangeRequest;
    switch (name) {
      case "tap.add": arg(2); request = { kind: "tap.add", name: positional[0]!, url: positional[1]!, ...(value("ref") ? { ref: value("ref")! } : {}) }; break;
      case "tap.update": request = { kind: "tap.update", ...(arg(1, true) ? { name: positional[0]! } : {}), ...(value("ref") ? { ref: value("ref")! } : {}), allowRewind: opts.has("allow-rewind") }; break;
      case "tap.remove": case "tap.trust": case "tap.untrust": request = { kind: name, name: arg(1) }; break;
      case "adapter.add": request = { kind: name, module: arg(1), capabilities: (value("capabilities") ?? "").split(",").filter(Boolean) as AppliedOperationType[] }; break;
      case "adapter.remove": request = { kind: name, name: arg(1) }; break;
      case "install": request = { kind: "asset.install", coordinate: arg(1), placements: [placement()] }; break;
      case "upgrade": request = { kind: "asset.upgrade", ...(arg(1, true) ? { coordinate: positional[0]! } : {}) }; break;
      case "remove": request = { kind: "asset.remove", coordinate: arg(1) }; break;
      case "link": case "unlink": {
        const coordinate = arg(1); let selected = placement();
        if (!opts.has("scope")) {
          const installed = await service.query({ kind: "list" });
          const asset = resolveAsset(installed.assets, coordinate);
          const matches = installed.requirements.filter(r => r.ownerId === "manual" && r.rootCoordinate === asset.coordinate).flatMap(r => r.placements)
            .filter(p => p.target === selected.target && (!value("root") || p.rootOverride === selected.rootOverride));
          if (matches.length > 1) invalid("Multiple placements match; specify --scope, --project, and --root as needed.");
          if (name === "unlink" && matches.length === 1) selected = matches[0]!;
        }
        request = { kind: name === "link" ? "placement.link" : "placement.unlink", coordinate, placement: selected }; break;
      }
      case "bundle.apply": arg(0); if (!value("file")) invalid("--file is required"); request = { kind: "bundle.apply", file: value("file")!, updateLock: opts.has("update-lock") }; break;
      case "bundle.detach": arg(0); if (!value("binding")) invalid("--binding is required"); request = { kind: "bundle.detach", binding: value("binding")! }; break;
      case "cleanup": arg(0); request = { kind: "cleanup" }; break;
      case "repair": request = { kind: "repair", coordinate: arg(1), overwriteOwned: opts.has("overwrite-owned"), ...(["target", "scope", "project", "root"].some(k => opts.has(k)) ? { placement: placement() } : {}) }; break;
      default: invalid("Unsupported command");
    }
    mode = opts.has("dry-run") ? "preview" : "execute";
    return output(envelope(mode === "preview" ? await service.plan(request) : await service.execute(request)), 0);
  } catch (cause) {
    const error = cause instanceof HarnessError ? cause : new HarnessError("INTERNAL_ERROR", cause instanceof Error ? cause.message : "Unexpected failure.", {}, { cause });
    const code = ["RECOVERY_REQUIRED", "RECOVERY_CONFLICT"].includes(error.code) ? 3 : ["INVALID_ARGUMENT", "INVALID_STATE", "UNSUPPORTED_FORMAT"].includes(error.code) ? 2 : error.code === "INTERNAL_ERROR" ? 4 : 1;
    return output({ format: "harnessbrew.result", version: 1, ok: false, command, mode, diagnostics: [], error: { code: error.code, message: error.message, details: error.details, ...(code === 3 ? { recovery: { action: "recover", preserve: "transaction.json and affected resources" } } : {}) } }, code);
  } finally { await service?.close(); }
}
