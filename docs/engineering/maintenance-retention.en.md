---
title: Maintenance Retention and Recovery Contracts
status: current
owner: project-maintainers
updated: 2026-10-09
---

# Maintenance Retention and Recovery Contracts

[中文主版本](maintenance-retention.md)

Applies to 1.3.0. See [retention.ts](../../src/application/retention.ts), [maintenance.ts](../../src/application/maintenance.ts), and [execution](../../src/application/maintenance-execution.ts).

## Classification and protection

Maintenance handles host caches/audit revisions, separate from content cleanup. Defaults: 30-day TTL, latest 10 per kind, advisory 1 GiB budget. Limits are nonnegative safe integers; budget does not authorize early removal of protected objects.

Unknown ownership, abnormal time, unknown size, or unresolved references are unknown. CURRENT, recovery evidence, valid plans, and live leases are protected, as are objects within TTL/latest-count limits. Only proven-owned expired unreferenced objects are deletable. Reports include total/retained/protected/over-budget bytes; unknown sizes limit accuracy.

Protect all state catalog snapshots, offline repair origins, registered plugins, user quarantines, Journal before/next and step evidence. Overlap protects ancestors, preventing parent deletion around descendant references. Live PID, permission uncertainty and PID reuse protect entire caches, irrespective of TTL. Cross-root references, corrupt protection records, unknown files, symlinks, and bare Git repositories remain conservatively.

## Plans and previews

Ordinary/upgrade plans expire 30 days after their last file write; apply returns PLAN_STALE with reason=expired. Missing deleted IDs return PLAN_NOT_FOUND. Short TTL cannot remove valid plans; expired references protect inputs until validated retirement in a collection transaction. planMaintenance stores time, policy, identities, digests, sizes and reasons. Apply does not add new candidates.

Enumeration covers plans, prepared, restores, source snapshots, plugin signatures, revisions and maintenance plans. Prepared/restore directories use .owner.json ownership. Source/plugins validate declarations and full inventories without importing plugins. Uninspected unknown directories may report zero bytes, not actual disk usage. Pending Home Journal blocks maintenance preview/application.

## Execution and recovery

applyMaintenance requires initialized Home and rechecks revision, references, bytes, devices/inodes under Home → cache lease guard. Live leases reject immediately; no target lock is needed. Retire only fully verified expired references within the same root; retain cross-root references.

cache/maintenance/transaction.json fsyncs evidence before quarantine rename and directory fsyncs. Recheck, record deleting, then validate each entry before removal. Already removed entries may be absent; rmdir only empty directories. Revisions quarantine locally to avoid cross-device rename.

Recovery processes recorded objects only. Identity changes, added files or modified data return RECOVERY_CONFLICT and retain journals/data. New consumers encountering pending maintenance return RECOVERY_REQUIRED and need recover-maintenance.

CURRENT, valid plan baseRevisions and recovery revisions take priority; maintenance preview files are protected for at least 30 days, then evaluated by TTL/latest-count retention. Application still revalidates inputs; this is not the ordinary saved-plan apply expiry rule. Revisions are not consistent rollback backups; quarantine is never automatically removed by TTL/budget. Protected history can exceed budget indefinitely.

See [maintenance instructions](../guides/maintenance.en.md) and [1.3.0 acceptance](../releases/1.3.0/validation.en.md).
