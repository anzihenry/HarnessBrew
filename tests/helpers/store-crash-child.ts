import { StateStore } from "../../src/storage/state-store.js";

const home = process.argv[2];
if (!home || !process.send) throw new Error("Expected Home and IPC channel");
const store = new StateStore(home, { async fault(checkpoint) {
  if (checkpoint === "revision-durable") {
    process.send?.(checkpoint);
    await new Promise<void>(() => { setInterval(() => undefined, 1000); });
  }
} });
const state = await store.read();
state.install.owners.push({ id: "manual", kind: "manual" });
await store.commit(state.revision, state);
