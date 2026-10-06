import { CacheLeases } from "../../src/application/cache-leases.js";
const cache = process.argv[2]!;
await new CacheLeases(cache).withLease(async () => {
  process.stdout.write("leased\n");
  await new Promise<void>(resolve => process.once("message", () => resolve()));
});
process.disconnect?.();
