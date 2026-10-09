---
title: 1.1.0 Candidate Acceptance
status: verified
owner: project-maintainers
updated: 2026-10-09
---

# 1.1.0 Candidate Acceptance

[中文主版本](validation.md)

Acceptance date: 2026-10-07 (Asia/Shanghai). Local candidate acceptance only, not npm/GitHub publication or a substitute for protected workflow provenance/approval.

## Candidate identity

Package harnessbrew@1.1.0, harnessbrew-1.1.0.tgz; clean source 2689d4a2834ddc0dd67405fda144581bafc65ed9; SHA-256 fe505af0bd57818596f64ef46ca77b0f88ebc8d27968e05391050df25ce698c9. Built on macOS arm64 / Node 24.19.0 / npm 12.0.2. The ignored release-artifacts/batch-a-final/ holds the tarball; [manifest](evidence/artifact-manifest.json) and [checksums](evidence/SHA256SUMS) are archived. Subsequent evidence-document commits are not candidate source.

## Results

| Check | Result | Environment/evidence |
| --- | --- | --- |
| Architecture/build/version | pass | npm run check |
| fast | 205/205 | Process contention, SIGKILL, preview drift, leases |
| regressions | 3/3 | npm run test:regressions |
| packaged | 19/19 | HARNESSBREW_TEST_CANDIDATE fixed to final candidate |
| Linux gate | pass | node:22-bookworm container, arm64 / Node 22.23.3 / npm 11.17.0; [report](evidence/release-gate-linux.json) |
| macOS gate | pass | arm64 / Node 24.19.0 / npm 12.0.2; [report](evidence/release-gate-macos.json) |
| Real Codex | 4/4 | codex-cli 0.160.1; [report](evidence/runtime-report.json) |
| Identity/completeness | pass | scripts/release/evidence.mjs checks digest/source/platform/probes/time |

Both gates cover artifact, package-smoke and packaged-e2e. Skill/instruction/agent/MCP passed; Agent cooperation events/session cleanup and MCP structured events/actual fixture calls were observed. Modified-content recovery and original quarantine retention passed. Mock runtime tests are excluded.

## Failures and resolution

Two old tests hardcoded 1.0.0 after switching to 1.1.0. They now read package version; version checks 6/6 and full fast 205 passed. Test-only fix 2689d4a produced identical tarball bytes but final platform/runtime reports were regenerated for the final source SHA.

Previous skill/instruction passed while agent/MCP failed. The [failure report](evidence/runtime-report-initial-failed.json) remains; redacted data does not establish regression or quota root cause. Final candidate reran all four successfully without relaxing markers, cooperation events or real MCP calls.

## Compatibility, rollback and publication

See the [six-case benchmark](../../initiatives/refactor/preparation-boundary/benchmark.en.md) and [version record](README.en.md). Regenerate saved-plan v1; A introduces no active Home migration. Roll back only to a verified pre-A source build, not public 0.7.1 for v1 Homes.

No branch push, tag, npm publication or production workflow occurred. This local Linux/runtime validation does not replace protected workflow provenance/approval. Use [release procedures](../../guides/releasing.en.md) with the prescribed toolchain and dedicated runtime runner. Historical results do not guarantee freshness for future publication.
