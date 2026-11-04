import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { writeFormula } from "../e2e/fixture-tap.mjs";

const run = promisify(execFile);
const root = await realpath(await mkdtemp(path.join(tmpdir(), "harnessbrew-demo-")));
const repository = path.join(root, "tap");
await mkdir(repository);
await writeFile(path.join(repository, "tap.json"), '{"format":"harnessbrew.tap","version":1}\n');
await writeFormula(repository, { name: "helper-skill", kind: "skill" }, "demo");
await writeFormula(repository, {
  name: "main-skill", kind: "skill", dependencies: ["demo/assets/helper-skill"]
}, "demo");
const git = (...args) => run("git", args, { cwd: repository });
await git("init", "--initial-branch=main");
await git("add", ".");
await git("-c", "user.name=HarnessBrew Demo", "-c", "user.email=demo@example.invalid",
  "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-m", "Create demo assets");
console.log(root);
