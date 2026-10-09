---
title: 1.2.0 Candidate Acceptance
status: verified
owner: project-maintainers
updated: 2026-10-09
---

# 1.2.0 Candidate Acceptance

[中文主版本](validation.md)

Acceptance date: 2026-10-07 (Asia/Shanghai). B01–B10 completed by dependency, with B08 before B07 as required. Local candidate passed; not officially published.

## Candidate identity

harnessbrew@1.2.0, clean source fc40a3efda361301b0801feae7a1cf72bf18b6d9, SHA-256 1d61c99b85ed663a89582e828751656c4dad678db571b75073741dc7690019de. Built on macOS arm64 / Node 24.19.0 / npm 12.0.2. [Manifest](evidence/artifact-manifest.json), [checksums](evidence/SHA256SUMS). Tarball is in ignored release-artifacts/batch-b/; later evidence-document commits are not candidate source.

## Results

| Check | Result | Environment/evidence |
| --- | --- | --- |
| Architecture/build/version | pass | npm run check |
| fast | 243/243 | Inspection/grants/pins/concurrency/crash/Bundle/rollback/compatibility |
| packaged | 19/19 | Explicit shared candidate including packaged Adapter identity/CLI |
| regressions | 3/3 | A and existing upgrade/conflict coverage |
| Linux gate | pass | Docker arm64 / Node 22.23.3 / npm 11.17.0; [report](evidence/release-gate-linux.json) |
| macOS gate | pass | arm64 / Node 24.19.0 / npm 12.0.2; [report](evidence/release-gate-macos.json) |
| Real Codex | 4/4 | 0.162.0-alpha.2; [report](evidence/runtime-report.json) |
| Actual A install→B upgrade→consistent rollback | pass | [Two-package report](evidence/adapter-upgrade-report.json) |
| Evidence | pass | release/evidence.mjs validates identity, platforms, four probes, time; two-package identities separately checked |

Both gates include artifact, package-smoke, packaged-e2e. Four probes passed on first attempt; Agent events/session cleanup and MCP events/actual calls observed. Modified-content recovery/quarantine passed. Mock runtime results are excluded. Docker daemon was initially stopped; after starting installed Docker Desktop the unchanged candidate passed, without weakening acceptance.

## Cross-version and rollback evidence

Retained A 1.1.0: source 2689d4a2834ddc0dd67405fda144581bafc65ed9, digest fe505af0bd57818596f64ef46ca77b0f88ebc8d27968e05391050df25ce698c9. The old CLI actually created manual installs/two Bundles. B explicitly authorized the built-in candidate and updated registration/both locks, preserving pins/dependencies. Old readers could read v1 Home. After consistent restoration of Home/targets/locks, old list/adapter list/doctor passed.

Old tarball lives in release-artifacts/batch-a-final/. Rehearsal backups are in release-artifacts/batch-b/upgrade/rollback-backup/, with locations.json recording original test paths. They back up temporary fixtures, not user installations. Production rollback requires consistent backups of the actual Home/all managed targets/all locks.

[Compatibility contracts](../../engineering/adapter-upgrades.en.md) limit guarantees: ordinary v2, upgrade v3, Home/Journal/Bundle/CLI v1. Structure compatibility is not executable compatibility; binary downgrade alone is not rollback. Reverse third-party upgrade, external-lock refusal, backup restoration and SIGKILL around every lock are covered. Unrecorded after-write retains Journal and may need manual inspection rather than guaranteed rollback.

## Publication boundary

No push, tag, npm publication or production workflow. Local Docker/Codex validation does not replace protected evidence provenance, toolchain, dedicated runtime runner or approval. Follow [release procedures](../../guides/releasing.en.md) and revalidate same-candidate identity and 72-hour evidence freshness.
