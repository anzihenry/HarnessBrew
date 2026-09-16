import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const directory = process.argv[2];
if (!["dist", ".test-dist"].includes(directory)) {
  throw new Error("Expected a generated build directory: dist or .test-dist");
}
await rm(fileURLToPath(new URL(`../${directory}/`, import.meta.url)), { recursive: true, force: true });
