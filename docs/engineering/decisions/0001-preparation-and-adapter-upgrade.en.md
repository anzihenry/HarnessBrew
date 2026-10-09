---
title: "0001: Preparation Boundaries and Adapter Upgrade Authorization"
status: current
owner: project-maintainers
updated: 2026-10-09
---

# 0001: Preparation Boundaries and Adapter Upgrade Authorization

[中文主版本](0001-preparation-and-adapter-upgrade.md)

Decision date: 2026-10-06; rechecked during migration against implemented batches A/B/C. Covers preparation boundaries, candidate authorization, and format evolution. See [architecture](../architecture.en.md), [upgrade contracts](../adapter-upgrades.en.md), and [retention](../maintenance-retention.en.md).

## Context and alternatives

Git/plugin/content preparation is slow; holding transaction locks blocks queries and unrelated work. Full candidate upgrade differences require plugin plan execution and cannot be entirely static. Alternatives were preparing under transaction locks, treating inspection as authorization, and updating registration before targets. They increase contention, imply code authorization, or permit partial success.

## Decision

Read a consistent snapshot under short locks, prepare outside, recover/revalidate evidence under the existing commit lock order. Drift returns PLAN_STALE, never silent replanning. Execute recovers first; plan/query reject pending Journal; apply does not prepare again; first plan does not initialize Home.

Separate static inspection from digest/capability authorization; load only an authorized candidate for accurate planning. Registration, placements and all affected Bundle locks commit together, preserving asset pins. Distinguish protocol, version, signature; version signature rules and never ignore changed digests because version matches.

Prepared data contains request, revision, physical Home, fixed sources/candidate, external fingerprints and staging references, not callbacks/instances. Ordinary previews v2, upgrade v3; do not silently extend persistent strict v1 structures. Reject incompatibility explicitly. Leases precede cache access; durable references protect inputs after creator exit.

## Consequences and validation

Contention requires explicit retries; staging may be consumed and require regeneration. Plugins retain host privileges. Leases/references and conservative GC add maintenance complexity; do not collect with mixed old binaries. Structural compatibility is not behavioral compatibility; retain packages and consistent backups for rollback.

See [preparation](../../initiatives/refactor/preparation-boundary/README.en.md), [upgrades](../../initiatives/feature/adapter-upgrade/README.en.md), and [version evidence](../../releases/README.en.md). No replacement decision exists; future changes require a new numbered record and status update.
