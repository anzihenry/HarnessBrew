---
title: 1.3.0 Candidate Acceptance
status: verified
owner: project-maintainers
updated: 2026-10-09
---

# 1.3.0 Candidate Acceptance

[中文主版本](validation.md)

Acceptance date: 2026-10-08 (Asia/Shanghai). C01–C10 completed; local candidate passed, not officially published.

## Candidate identity

harnessbrew@1.3.0, clean source 1b95071e2f2580398742419438054c7676113a6e, SHA-256 b97157a39adef37666d97b49ac6366e2663d81d22077d0878b600d2fa2964fa4. Built on macOS arm64 / Node 24.19.0 / npm 12.0.2. [Manifest](evidence/artifact-manifest.json), [checksums](evidence/SHA256SUMS). Tarball lives in ignored release-artifacts/batch-c-final/; later evidence-document commits are not candidate source.

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| Architecture/build/version | pass | npm run check |
| fast | 286/286 | Maintenance, real crashes, leases, cancellation, close, progress, combinations |
| packaged | 19/19 | Explicit final HARNESSBREW_TEST_CANDIDATE |
| regressions | 3/3 | npm run test:regressions |
| macOS gate | pass | Node 24.19.0 / npm 12.0.2; [report](evidence/release-gate-macos.json), [7 scenarios](evidence/e2e-macos.md) (English) |
| Linux gate | pass | Docker arm64 / Node 22.23.3 / npm 11.17.0; [report](evidence/release-gate-linux.json), [7 scenarios](evidence/e2e-linux.md) (English) |
| Real Codex | 4/4 | 0.162.0-alpha.2; [report](evidence/runtime-report.json) |
| B install→C upgrade→consistent rollback | pass | [Two-package report](evidence/adapter-upgrade-report.json) |
| Unified evidence | pass | RELEASE_COMMIT=1b95071e2f2580398742419438054c7676113a6e node scripts/release/evidence.mjs release-artifacts/batch-c-final |

[Test counts](evidence/test-summary.json) record suites. Both platforms cover artifact, package-smoke, packaged-e2e. Maintenance-controls verifies plan protection, unchanged CURRENT, apply after maintenance, stdout/stderr separation and timeout exit. Skill/instruction/agent/MCP passed, including Agent events, actual MCP calls, session cleanup, repaired content and retained quarantine. Mock runtime is excluded.

Combined cases: maintenance refuses removal while upgrade preparation leases live; close waits for upgrades/leases; cancellation after writing two locks restores CURRENT/locks; postcommit cleanup failure returns committed and recover retains new signatures.

## Findings and fixes

Initial source 58f637f75504eea275cf3c79149335d718484f70 exposed a Home parent alias issue on macOS. /tmp canonicalization happened during snapshot reading, but maintenance captured the earlier path, conservatively marking valid plans unknown and blocking maintenance. No incorrect deletion occurred.

Fix 1b95071 reads snapshot before canonical Home, with cross-platform explicit parent-symlink regression covering new-service preview/maintenance/original upgrade apply. Rebuilt a clean candidate and reran full tests, both platforms and real runtime. Initial release-artifacts/batch-c/ is not final passing evidence.

## Compatibility and rollback

Retained B 1.2.0 source fc40a3efda361301b0801feae7a1cf72bf18b6d9, digest 1d61c99b85ed663a89582e828751656c4dad678db571b75073741dc7690019de. Old CLI actually installed manual assets/two Bundles; C explicitly authorized built-in upgrade and verified unchanged pins, all locks and old-reader compatibility. Consistent restoration passed old doctor.

Backups in release-artifacts/batch-c-final/upgrade/rollback-backup/ are temporary test Homes only, not user backups. Revisions are not full backups.

Ordinary v2/upgrade v3/Home-Journal-Bundle v1 remain. Saved plans now expire after 30 days and must be regenerated. Built-in closure changes still require authorization. TTL 30 days/latest 10/advisory 1 GiB never overrides plans/live operations/CURRENT/quarantines. Unknown/cross-root/referenced history/bare Git remain; budget convergence is not guaranteed.

Cancellation occurs at safe points; rollback/recovery can exceed deadlines. Postcommit remains committed. Close drains accepted work, not implicit cancellation. See [notes](README.en.md), [retention](../../engineering/maintenance-retention.en.md), [controls](../../engineering/operation-control.en.md).

No push, tag, npm publication or production workflow. Local Docker/Codex does not replace protected publication/provenance/runner requirements. Recheck same candidate/freshness under [release procedures](../../guides/releasing.en.md).
