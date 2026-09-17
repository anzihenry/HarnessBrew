# HarnessBrew 0.8.0 Release Plan

`0.8.0` focuses built-in Target support on OpenAI Codex and hardens CLI errors, Adapter trust migration, clean installs, and the release pipeline. This document describes the planned release, not evidence that publication has completed.

## Compatibility and migration

- Claude Code is no longer a built-in Target. Remove its placements from Harnessfiles before reproducing environments. Existing receipts remain diagnosable and safely uninstallable; linking, relinking, and upgrading a removed Target require a compatible registered Adapter.
- Adapter records without an integrity baseline cannot load. Review the plugin and its dependencies, then explicitly remove and re-add it. Existing entry digests remain entry-only; `entry-file-sha256-v1` does not attest imported files or dependencies.
- JSON-mode filesystem and unexpected exceptions now return a schema v1 failure envelope with `INTERNAL_ERROR` and exit code 1. Existing domain error codes remain unchanged.

## Changes

- Cover all 12 Codex asset/scope placements and remove Claude runtime probes and skip exceptions.
- Use the official npm registry for project installs and every locked dependency, preserving dependency versions and integrity digests.
- Clean compiler output before builds so deleted modules do not survive in packages.
- Automate candidate creation, Linux/macOS gates, authenticated runtime probes, evidence verification, one protected approval, npm publication, and six verified GitHub Release attachments.
- Reject incomplete, mismatched, or stale evidence and conflicting existing tags, npm bytes, or Release assets. Retry publication safely when an already-published package has identical bytes.

## Acceptance criteria

- `npm run check` succeeds and all package/source versions agree on `0.8.0`.
- CI passes on Node.js 22/npm 11.17.0 and Node.js 24/npm 12.0.2.
- The same immutable candidate passes Linux/macOS gates and all four authenticated Codex probes.
- The dedicated runtime runner and `HARNESSBREW_RUNTIME_READY` declaration are configured.
- The `npm-production` environment has required reviewers and its deployment is approved.
- npm smoke verification passes and the public Release includes the tarball, manifest, checksum, both platform reports, and runtime report.

## Publication

Follow [the release runbook](release-runbook.md). Commit reviewed release source to `main`, then dispatch **Publish approved npm candidate** once. Do not create a replacement `0.7.1` package, bypass missing prerequisites, or treat local source tests as authenticated runtime evidence.
