---
title: Cross-Initiative Delivery History
status: current
owner: project-maintainers
updated: 2026-10-09
---

# Cross-Initiative Delivery History

[中文主版本](delivery-history.md)

This records completed milestones/dependencies, not pending tasks. Initiative entries own task status; release records own candidate/publication status.

| Milestone | Dependencies and outcome | Initiative |
| --- | --- | --- |
| Unified state/transactions, 1.0 baseline | Domain→sources/Resolver→Planner/Adapter→Executor/Journal→application→legacy removal; local dirty candidate, not publication | [Refactor](../initiatives/refactor/unified-state-transactions/README.en.md) |
| Content lifecycle | Inventory→cleanup→exact restore→quarantine transaction→diagnostics/SDK; included in later A baseline | [Content](../initiatives/feature/content-lifecycle/README.en.md) |
| A: boundaries/preparation, 1.1.0 | Contracts/benchmarks, leases, outside-lock preparation and commit revalidation | [Preparation](../initiatives/refactor/preparation-boundary/README.en.md) |
| B: atomic Adapter upgrades, 1.2.0 | Depends on A; manual flow before joint Bundles, strict formats/rollback evidence | [Upgrades](../initiatives/feature/adapter-upgrade/README.en.md) |
| C: maintenance/controls, 1.3.0 | Depends on A leases/B upgrades; protects inputs, cancels safely and drains | [Maintenance](../initiatives/feature/maintenance-controls/README.en.md) |

Old effort estimates/proposed interfaces no longer guide execution and are removed. Thirty-two task records are consolidated into these milestones/initiative outcomes, avoiding duplicate checked status. [Documentation migration](../initiatives/process/documentation-standard/README.en.md) is a new process initiative; its completion is not product publication.

The [release index](../releases/README.en.md) tracks 1.x candidates; earlier changes remain in [CHANGELOG](../../CHANGELOG.en.md).
