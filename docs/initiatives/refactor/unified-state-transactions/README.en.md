---
title: Unified State and Transaction Refactoring
status: completed
owner: project-maintainers
updated: 2026-10-09
---

# Unified State and Transaction Refactoring

[中文主版本](README.md)

## Goal, scope and completion criteria

Replace Receipt/Cellar with domain models, unified Resolver/Planner, immutable state and durable Journal, sharing application entry points between CLI/SDK. Scope includes phase 1 design through phase 7 removal. Completion means coverage of installs, Bundles, ownership, diagnostics, recovery and historical regressions, with old modules excluded from packages.

## Historical outcomes

The phase 7 record dated 2026-10-03 reports local completion: 21 core modules and 15 legacy-specific tests removed; locks, crashes, shared ownership and A02/A03/A05 regressions moved to the new service. Fast 142, packaged 19, regressions 3 passed, with macOS/Linux gates and four real Codex 0.159.2 probes.

Historical development candidate 1.0.0 used base ea005e0d76a0e4dcc873fe51cfe8ade53cdac960, SHA-256 1ddd6d54db75a18c40bb35e5c95c2479a8b0f8c7729d01d885df8b357b179768, source.dirty=true. Original reports lived only in ignored release-artifacts/phase7/, not a complete repository archive. They do not certify a clean release candidate or publication. Initial sandbox probes failed without an established cause; network-enabled retries passed and are separate results.

## Current references and validation

Rules are consolidated in [architecture](../../../engineering/architecture.en.md), [contracts](../../../engineering/contracts.en.md), and [locks](../../../engineering/file-locks.en.md); procedures in [guides](../../../guides/README.en.md). [1.0.0](../../../releases/1.0.0/README.en.md) preserves publication boundaries.

Completed means the historical refactoring goal, not publication eligibility of the old candidate. Historical design, task IDs and phase test counts are consolidated; this entry alone maintains initiative status. Current code defines local implementation details. See the [index](../../README.en.md) for subsequent A/B/C work and [migration validation](../../process/documentation-standard/validation.en.md) for this documentation review.
