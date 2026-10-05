import { once } from "node:events";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { withFileLock, type LockCheckpoint } from "../../src/transactions/file-lock.js";
const [lock, checkpoint, counter] = process.argv.slice(2);
if (!lock || !checkpoint || !process.send) throw new Error("Expected lock, checkpoint and IPC");
if (checkpoint === "contend") {
  if (!counter) throw new Error("Expected counter");
  for (let round = 0; round < 8; round++) {
    await withFileLock(lock, async () => {
      // Independent exclusive guard catches overlapping critical sections immediately.
      await mkdir(`${counter}.guard`);
      const value = Number(await readFile(counter, "utf8"));
      await appendFile(`${counter}.trace`, `${process.pid}:start\n`);
      await writeFile(counter, String(value + 1));
      await appendFile(`${counter}.trace`, `${process.pid}:end\n`);
      await rm(`${counter}.guard`, { recursive: true });
    }, { retryMs: 2, fault: async point => {
      if (round === 0 && point === "choosing-published") {
        const resume = once(process, "message"); process.send?.("ready"); await resume;
      }
    } });
  }
} else {
  await withFileLock(lock, async () => {}, { fault: async point => {
    if (point === checkpoint as LockCheckpoint) {
      process.send?.(point); await new Promise(() => {});
    }
  } });
}
process.disconnect();
