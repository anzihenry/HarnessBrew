import { appendFile } from "node:fs/promises";
import { once } from "node:events";
import { withFileLock } from "../../src/core/locks.js";

const [lockPath, tracePath, name] = process.argv.slice(2);
if (!lockPath || !tracePath || !name || !process.send) throw new Error("Expected lock, trace, name and IPC");
if (name === "second") {
  let blocked = false;
  try {
    await withFileLock(lockPath, async () => { throw new Error("Acquired a lock still held by the first process"); }, { timeoutMs: 50, retryMs: 5 });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("Timed out waiting for lock:")) throw error;
    blocked = true;
  }
  if (!blocked) throw new Error("Expected lock contention");
  process.send("blocked");
}
await withFileLock(lockPath, async () => {
  await appendFile(tracePath, `${name}:start\n`);
  const release = once(process, "message");
  process.send?.("acquired");
  await release;
  await appendFile(tracePath, `${name}:end\n`);
});
process.disconnect();
