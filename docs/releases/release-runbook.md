# Release Verification Runbook

This runbook is the operational path for `0.7.0` and later releases. It separates deterministic GitHub Actions checks from authenticated local Codex and Claude Code checks while keeping one immutable npm tarball throughout the process.

## 1. Prepare the release source

Update the package version, lockfile, source version, changelog, and release notes together. Run:

```bash
npm ci
npm run check
git status --short
```

Commit the release source before creating a candidate. The candidate builder rejects dirty release worktrees.

## 2. Build and verify the candidate in GitHub

Run the **Release candidate** workflow with the exact commit or tag as `ref`. Record its workflow run ID.

The workflow:

- runs source validation
- builds the npm tarball exactly once
- records `artifact-manifest.json` and `SHA256SUMS`
- passes the same downloaded bytes through `release:gate` on Linux and macOS
- retains the candidate and per-platform reports for 30 days

Do not rebuild the candidate locally. Download the `release-candidate-<run-id>` artifact and both `release-gate-<run-id>-<os>` artifacts. Confirm both gate reports contain the same SHA-256 as the manifest.

## 3. Run authenticated Agent checks locally

Use a trusted workstation where `codex` and `claude` are already authenticated. The command uses isolated project, HarnessBrew, Codex, Claude, npm, and Git paths for installed probe assets. Authentication remains owned by each local CLI.

```bash
npm run release:preflight -- \
  --package /absolute/path/harnessbrew-0.7.0.tgz \
  --manifest /absolute/path/artifact-manifest.json \
  --checksums /absolute/path/SHA256SUMS \
  --report-dir /absolute/path/runtime-evidence
```

The preflight verifies four nonce-bearing probes for each runtime:

- an explicitly invoked Skill
- an Instruction observed in active context
- a delegated custom Agent with structured activity evidence
- a credential-free local MCP tool call confirmed by both runtime events and the fixture log

The default command fails unless Codex and Claude Code both pass. `--allow-skips` is only for development diagnostics; an `incomplete` report cannot approve a production release. Use `--keep` only while debugging because it retains the otherwise temporary probe workspace.

The report records candidate identity, platform, CLI versions, statuses, failure classes, timings, and bounded event metadata. It does not store authentication, environment secrets, prompts, model reasoning, or complete runtime output.

## 4. Triage failures

- `product-failure`: the packaged asset, placement, configuration, or MCP integration is wrong. Fix the source and create a new candidate.
- `behavioral-failure`: the runtime loaded the probe but did not follow the explicit request. The preflight retries once; a repeated failure blocks release.
- `provider-failure`: rate limit, upstream service, timeout, or network failure. Retry the same candidate later.
- `environment-failure`: CLI, authentication, or local setup is unavailable. Repair the workstation and rerun.

Never reinterpret a skip or provider failure as a pass.

## 5. Approve and publish

After both deterministic platform gates and both local runtimes pass:

1. create the immutable Git tag at the candidate manifest commit
2. push the tag
3. run **Publish approved npm candidate** with the exact `tag` and candidate workflow `candidate-run-id`
4. review the pending deployment and approve the protected `npm-production` environment

The publish job downloads the retained candidate from that workflow run and verifies its commit, tag, version, filename, package metadata, and SHA-256. It publishes the existing `.tgz` with npm provenance and never invokes a build or pack command.

The following job installs the exact published version from npm into a clean prefix and verifies version, help, public ESM exports, and a minimal local Tap lifecycle.

## 6. Recovery

Before npm publication, fix the source and create a new candidate; never modify a retained candidate. After npm accepts a version, do not move its tag or try to replace its bytes. Diagnose the issue and release a new patch version.
