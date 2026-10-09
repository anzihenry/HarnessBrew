---
title: Preparation Outside Locks and Boundary Refactoring
status: completed
owner: project-maintainers
updated: 2026-10-09
---

# Preparation Outside Locks and Boundary Refactoring

[中文主版本](README.md)

## Goal, scope and completion criteria

A01–A12 refactored use cases/ports and unified Git/plugin/content preparation outside transaction locks, preserving commit validation, lock order and recovery invariants. Completion covers drift, initialization, aliases, references, multiprocess crashes and cross-platform acceptance of one candidate.

## Historical outcomes and evidence

Batch A delivered in 1.1.0. Fast 205, packaged 19, regressions 3, Linux/macOS gates and four real probes passed. [1.1.0 acceptance](../../../releases/1.1.0/validation.en.md) is the detailed identity/failure record.

[Benchmarks](benchmark.en.md) retain six single-run source-size measurements; raw JSON lives in evidence, not a claim about large installed populations or p95. [Methods](../../../guides/benchmarking.en.md) describe reproduction.

[Concurrency](../../../../tests/preparation-concurrency.test.ts), [freshness](../../../../tests/preparation-freshness.test.ts), [crash](../../../../tests/preparation-crash.test.ts), [lease](../../../../tests/cache-leases.test.ts), and [prepared-format tests](../../../../tests/prepared-change.test.ts) cover invariants; unrecorded writes still retain journals and report conflicts.

## Current references and closure

Historical A goals are complete; C later delivered maintenance GC. [Architecture](../../../engineering/architecture.en.md), [locks/leases](../../../engineering/file-locks.en.md), and [ADR](../../../engineering/decisions/0001-preparation-and-adapter-upgrade.en.md) remain current. This entry owns historical task status; cross-batch milestones are in [delivery history](../../../planning/delivery-history.en.md). See [migration review](../../process/documentation-standard/validation.en.md).
