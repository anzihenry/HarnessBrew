# 1.0.0 release preparation

This is a breaking release candidate, not a publication announcement.

## Changes

- CLI and SDK now share `createHarness` and a single planning/transaction pipeline.
- State revisions, explicit ownership, immutable content and journal recovery replace the legacy Receipt/Cellar backend.
- Source, asset, Bundle, lock and plugin declarations require the versioned formats documented in the README.
- Legacy CLI aliases and SDK functions are removed. Public package paths are `harnessbrew` and `harnessbrew/adapter`.
- The old backend and its dedicated tests have been removed. Package smoke checks reject legacy modules and unexpected public exports.

## Adopt the new contracts

1. Keep a backup of the old Home and manifests. Select a separate empty Home with `--home`; no automatic migration is provided.
2. Convert source/asset and Bundle declarations to the formats in the [README](../../README.md). Update plugins to the adapter package contract and explicitly authorize their capabilities.
3. Review old target resources before installing into the same locations. The new Home cannot claim ownership of files installed by the old Home.
4. Register and trust sources, preview installation or Bundle application, then apply the saved plan. Run `doctor` and verify the target runtime.
5. Update SDK callers to `createHarness` and remove legacy command aliases from scripts.

## Release checklist

- [ ] Commit the reviewed source and build one clean candidate with its manifest and checksums.
- [ ] Run source checks and historical regressions.
- [ ] Run packaged scenarios and release gate on Linux and macOS against that exact candidate.
- [ ] Run authenticated real Codex skill, instruction, agent and MCP probes against the same candidate.
- [ ] Verify matching hashes/commits, successful reports and the release evidence freshness window.
- [ ] Complete the existing protected publication workflow after explicit release authorization.

The candidate workflow now includes historical regressions before building. Local validation of uncommitted changes is development evidence only. Actual phase 7 results and remaining environment blockers are recorded in [the implementation record](../design/phase7-implementation.zh-CN.md).
