import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const binaryUrl = new URL(`../${packageJson.bin.harnessbrew}`, import.meta.url);

await access(binaryUrl);
const result = await execFileAsync(process.execPath, [binaryUrl.pathname, "--version"], { encoding: "utf8" });
assert.equal(result.stdout.trim(), packageJson.version);
assert.equal(packageJson.devDependencies.typescript, "^7.0.2");
console.log(`Package smoke test passed for harnessbrew@${packageJson.version}.`);
