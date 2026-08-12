import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { runCli } from "../src/cli.js";
import {
  captureTransactionPath,
  recoverTransactions,
  transactionsRoot,
  withJournalPreview,
  withJournalTransaction
} from "../src/core/journal.js";

const execFileAsync = promisify(execFile);
const journalUrl = new URL("../src/core/journal.js", import.meta.url).href;
const locksUrl = new URL("../src/core/locks.js", import.meta.url).href;
const transactionUrl = new URL("../src/core/targets/transaction.js", import.meta.url).href;

async function crashTargetWrite(home: string, destination: string, label: string): Promise<void> {
  const script = `
    import { withJournalTransaction } from ${JSON.stringify(journalUrl)};
    import { withHomeLock } from ${JSON.stringify(locksUrl)};
    import { executeTargetOperations } from ${JSON.stringify(transactionUrl)};
    const [home, destination, label] = process.argv.slice(1);
    await withHomeLock(home, () => withJournalTransaction(home, label, async () => {
      await executeTargetOperations([{
        id: "docs",
        type: "merge-config",
        target: "claude-code",
        destination,
        configFormat: "json",
        ownedKeys: ["mcpServers", "docs"],
        content: JSON.stringify({ type: "stdio", command: "docs-server" })
      }]);
      process.exit(77);
    }));
  `;
  await assert.rejects(
    execFileAsync(process.execPath, ["--input-type=module", "-e", script, home, destination, label]),
    (error: unknown) => (error as { code?: number }).code === 77
  );
}

test("journal transactions restore modified and newly created paths after an exception", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "harnessbrew-journal-"));
  const existing = path.join(home, "existing.txt");
  const created = path.join(home, "created.txt");
  await writeFile(existing, "before\n");
  await chmod(existing, 0o640);

  await assert.rejects(withJournalTransaction(home, "failing-write", async () => {
    await captureTransactionPath(existing);
    await captureTransactionPath(created);
    await writeFile(existing, "after\n");
    await chmod(existing, 0o600);
    await writeFile(created, "temporary\n");
    throw new Error("injected failure");
  }), /injected failure/);

  assert.equal(await readFile(existing, "utf8"), "before\n");
  assert.equal((await lstat(existing)).mode & 0o777, 0o640);
  await assert.rejects(lstat(created), /ENOENT/);
  assert.deepEqual(await readdir(transactionsRoot(home)), []);
});

test("journal previews report path changes and always restore the original filesystem", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "harnessbrew-preview-"));
  const existing = path.join(home, "existing.txt");
  const created = path.join(home, "created.txt");
  await writeFile(existing, "before\n");

  const preview = await withJournalPreview(home, "preview-write", async () => {
    await captureTransactionPath(existing);
    await captureTransactionPath(created);
    await writeFile(existing, "after\n");
    await writeFile(created, "temporary\n");
    return "planned";
  });

  assert.equal(preview.result, "planned");
  assert.deepEqual(preview.changes.map((change) => path.basename(change.path)).sort(), ["created.txt", "existing.txt"]);
  assert.equal(preview.changes.find((change) => change.path === created)?.before.kind, "missing");
  assert.equal(await readFile(existing, "utf8"), "before\n");
  await assert.rejects(lstat(created), /ENOENT/u);
  assert.deepEqual(await readdir(transactionsRoot(home)), []);
});

test("the next mutating CLI command reclaims a crashed lock and recovers its target journal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-crash-recovery-"));
  const home = path.join(root, "home");
  const destination = path.join(root, ".mcp.json");
  await mkdir(home, { recursive: true });
  await writeFile(destination, `${JSON.stringify({ theme: "dark" }, null, 2)}\n`);
  await crashTargetWrite(home, destination, "crashed-target-write");
  assert.match(await readFile(destination, "utf8"), /docs-server/u);

  const exitCode = await runCli(
    ["untap", "missing/tap"],
    { stdout: () => undefined, stderr: () => undefined },
    { home }
  );
  assert.equal(exitCode, 1);
  assert.deepEqual(JSON.parse(await readFile(destination, "utf8")), { theme: "dark" });
  assert.deepEqual(await readdir(transactionsRoot(home)), []);
});

test("recovery preserves a shared target changed by another transaction after the crash", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "harnessbrew-crash-conflict-"));
  const home = path.join(root, "home");
  const destination = path.join(root, ".mcp.json");
  await mkdir(home, { recursive: true });
  await writeFile(destination, `${JSON.stringify({ theme: "dark" }, null, 2)}\n`);
  await crashTargetWrite(home, destination, "conflicting-target-write");

  const laterContent = {
    theme: "dark",
    mcpServers: {
      docs: { type: "stdio", command: "docs-server" },
      search: { type: "stdio", command: "search-server" }
    }
  };
  await writeFile(destination, `${JSON.stringify(laterContent, null, 2)}\n`);
  const errors: string[] = [];
  const exitCode = await runCli(
    ["untap", "missing/tap"],
    { stdout: () => undefined, stderr: (message) => errors.push(message) },
    { home }
  );

  assert.equal(exitCode, 1);
  assert.match(errors.join("\n"), /Transaction recovery conflict/u);
  assert.deepEqual(JSON.parse(await readFile(destination, "utf8")), laterContent);
  assert.equal((await readdir(transactionsRoot(home))).length, 1);
});

test("recovery rejects an unsafe journal without touching its target", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "harnessbrew-journal-"));
  const victim = path.join(home, "victim.txt");
  const directory = path.join(transactionsRoot(home), "tampered");
  await mkdir(directory, { recursive: true });
  await writeFile(victim, "keep\n");
  await writeFile(path.join(directory, "journal.json"), `${JSON.stringify({
    schemaVersion: 1,
    id: "tampered",
    label: "unsafe",
    home,
    createdAt: new Date().toISOString(),
    entries: [{ path: home, kind: "missing" }]
  })}\n`);

  await assert.rejects(recoverTransactions(home), /Invalid transaction journal/);
  assert.equal(await readFile(victim, "utf8"), "keep\n");
});
