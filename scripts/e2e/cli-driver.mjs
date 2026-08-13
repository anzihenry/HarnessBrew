import { spawn } from "node:child_process";
import path from "node:path";

function commandText(binary, args) {
  return [binary, ...args].map((value) => JSON.stringify(value)).join(" ");
}

export class PackagedCliDriver {
  constructor(environment, options = {}) {
    this.binary = environment.binary;
    this.environment = environment.environment;
    this.root = environment.root;
    this.defaultCwd = environment.paths.project;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.onResult = options.onResult ?? (() => {});
  }

  async run(args, options = {}) {
    const cwd = path.resolve(options.cwd ?? this.defaultCwd);
    const expectedExitCode = options.expectExitCode ?? 0;
    const startedAt = Date.now();
    const result = await new Promise((resolve, reject) => {
      const child = spawn(this.binary, args, {
        cwd,
        env: { ...this.environment, ...(options.env ?? {}) },
        shell: process.platform === "win32",
        stdio: ["ignore", "pipe", "pipe"]
      });
      const stdout = [];
      const stderr = [];
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, options.timeoutMs ?? this.timeoutMs);
      child.stdout.on("data", (chunk) => stdout.push(chunk));
      child.stderr.on("data", (chunk) => stderr.push(chunk));
      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (exitCode, signal) => {
        clearTimeout(timeout);
        resolve({
          args: [...args],
          cwd,
          exitCode,
          signal,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
          durationMs: Date.now() - startedAt,
          timedOut
        });
      });
    });
    this.onResult(result);
    if (result.timedOut) throw new Error(`Packaged CLI timed out: ${commandText(this.binary, args)}`);
    if (result.exitCode !== expectedExitCode) {
      throw new Error([
        `Unexpected packaged CLI exit code ${String(result.exitCode)} (expected ${expectedExitCode}):`,
        commandText(this.binary, args),
        result.stdout === "" ? "" : `stdout:\n${result.stdout}`,
        result.stderr === "" ? "" : `stderr:\n${result.stderr}`
      ].filter((line) => line !== "").join("\n"));
    }
    return result;
  }

  async runJson(args, options = {}) {
    const result = await this.run([...args, "--json"], options);
    const output = result.stdout.trim();
    if (output === "" || output.includes("\n")) {
      throw new Error(`Packaged CLI JSON mode must emit exactly one JSON document. Received: ${JSON.stringify(output)}`);
    }
    let envelope;
    try {
      envelope = JSON.parse(output);
    } catch {
      throw new Error(`Packaged CLI emitted invalid JSON: ${output}`);
    }
    if (envelope.schemaVersion !== 1 || typeof envelope.ok !== "boolean" || typeof envelope.exitCode !== "number") {
      throw new Error(`Packaged CLI emitted an invalid schema v1 envelope: ${output}`);
    }
    if (envelope.exitCode !== result.exitCode || envelope.ok !== (result.exitCode === 0)) {
      throw new Error(`Packaged CLI JSON envelope disagrees with its process exit code: ${output}`);
    }
    return { ...result, envelope };
  }
}
