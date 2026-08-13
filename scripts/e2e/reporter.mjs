import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertPathInside } from "./environment.mjs";

export class E2EReporter {
  constructor(root, reportsDirectory) {
    this.root = path.resolve(root);
    this.reportsDirectory = assertPathInside(this.root, reportsDirectory, "reports directory");
    this.commands = [];
    this.scenarios = [];
  }

  recordCommand(result) {
    this.commands.push({
      args: result.args,
      cwd: result.cwd,
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      stdout: result.stdout,
      stderr: result.stderr
    });
  }

  recordScenario(name, status, durationMs, error) {
    this.scenarios.push({
      name,
      status,
      durationMs,
      ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) })
    });
  }

  async write(artifact) {
    await mkdir(this.reportsDirectory, { recursive: true });
    const report = {
      schemaVersion: 1,
      artifact: artifact.package,
      source: artifact.source,
      platform: process.platform,
      architecture: process.arch,
      scenarios: this.scenarios,
      commands: this.commands,
      completedAt: new Date().toISOString()
    };
    const jsonPath = path.join(this.reportsDirectory, "e2e-report.json");
    const summaryPath = path.join(this.reportsDirectory, "e2e-summary.md");
    const summary = [
      "# HarnessBrew packaged E2E",
      "",
      `Candidate: \`${artifact.package.filename}\``,
      `SHA-256: \`${artifact.package.sha256}\``,
      "",
      "| Scenario | Status | Duration |",
      "| --- | --- | ---: |",
      ...this.scenarios.map((scenario) => `| ${scenario.name} | ${scenario.status} | ${scenario.durationMs} ms |`),
      ""
    ].join("\n");
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(summaryPath, summary, "utf8");
    return { jsonPath, summaryPath, report };
  }
}
