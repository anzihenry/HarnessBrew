---
title: Documentation Standard and Repository Migration
status: completed
owner: project-maintainers
updated: 2026-10-09
---

# Documentation Standard and Repository Migration

[中文主版本](README.md)

## Goal, scope and completion criteria

Migrate all project documentation to the agreed lifecycle standard, with Chinese primary files and default English pairs. Discard old paths/names and duplicated historical plans, without compatibility files. Owner project-maintainers denotes repository maintainers. This entry alone owns initiative task status.

Scope includes root README/CHANGELOG, all maintained documents, A/B/C candidate evidence, benchmark data, automation and CI. Completion requires explicit disposition of every source, accurate bilingual current content, unchanged evidence bytes, passing repository checks/tests, and no independent-review blockers. The final independent report and default check govern completion; failed approval blocks delivery.

## Delivery and deletion rules

| Source | Treatment |
| --- | --- |
| README.zh-CN / English README | Chinese README, English .en, detailed guides extracted |
| architecture/current design contracts | Engineering architecture/interfaces/content/locks/maintenance/controls/upgrades with English |
| refactor and phase2–7 | Consolidated transaction initiative with goals/results/candidate limitations/test links |
| Content implementation/A-B-C tasks | Initiative outcomes and planning milestones; remove stale estimates/proposed interfaces/duplicate checked tasks |
| Benchmarks/JSON | Procedures in guides; results/raw bytes with preparation initiative |
| release-runbook | Bilingual guides/releasing |
| Repeated 0.x publication plans | Delete; every original version-change bullet retained in bilingual CHANGELOG |
| 1.x notes/A-B-C acceptance | Version directories/real status, full bilingual acceptance, original reports moved unchanged |
| Old ten-file draft checks/review | Remove obsolete scripts/digests; replace with repository checks/current review |

[Inventory](evidence/migration-inventory.json) lists each source path/digest/disposition/reason/destination. It is audit evidence, not redirection. Original reports keep their language with bilingual summaries; historical changes retain context rather than pretending to be current behavior.

## Current references

[Standard/configuration](../../../documentation.en.md), [map](../../../README.en.md), [development checks](../../../guides/development.en.md), [validation](validation.en.md). No independent research/product/UX materials exist, so no empty domains are created. Status vocabularies follow document type.

## Tasks and progress

| Work | Status | Evidence |
| --- | --- | --- |
| Standard/configuration | Organized | Version 1.0; owner team, initiative task source, 90-day review |
| All historical material | Organized | Inventory; old directories/Chinese suffix removed without compatibility files |
| Current references/guides/languages/navigation | Organized | New hierarchy, corrected version/GC/protection/dry-run wording |
| Repository checks/tests | Passed | check:docs/test:docs, npm check, CI documentation job |
| Independent content/language/evidence review | See validation | validation owns findings, corrections, read scope and final identities |

No publication, push or remote-setting changes. CI code gates are installed; administrators configure required status checks and confirm them at merge. This does not change local documentation acceptance scope.
