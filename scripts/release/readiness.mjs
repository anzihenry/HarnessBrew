import assert from "node:assert/strict";
import { assertApproval, github } from "./github.mjs";

assert.equal(process.env.GITHUB_REF, "refs/heads/main", "release must be dispatched from main");
assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch");
assertApproval(await github("environments/npm-production"));
assert.equal(process.env.RUNTIME_READY, "true",
  "Provision the dedicated harnessbrew-runtime runner, then set repository variable HARNESSBREW_RUNTIME_READY=true.");
console.log("Release approval and runtime runner prerequisites are configured.");
