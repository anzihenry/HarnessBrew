#!/usr/bin/env node
import { runCli } from "./cli.js";
const controller = new AbortController();
const abort = () => controller.abort();
process.on("SIGINT", abort); process.on("SIGTERM", abort);
try { process.exitCode = await runCli(process.argv.slice(2), undefined, { signal: controller.signal }); }
finally { process.off("SIGINT", abort); process.off("SIGTERM", abort); }
