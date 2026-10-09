---
title: 1.3.0 Release Record
status: verified
owner: project-maintainers
updated: 2026-10-09
---

# 1.3.0 Release Record

[中文主版本](README.md)

Batch C passed local acceptance on 2026-10-08, not official publication. Adds conservative maintenance, cancellation, deadlines, progress and draining close. [Acceptance](validation.en.md) identifies the candidate/source.

Defaults: 30-day TTL, latest 10 per kind, advisory 1 GiB. Budget cannot override valid plans, live leases, CURRENT, registered plugins, sources and quarantine. Unknown/cross-root/referenced history/bare Git remains; convergence is not guaranteed. Plans expire after 30 days and must be regenerated; revisions are not backups.

SDK accepts independent signal/timeoutMs/onProgress; CLI supports deadlines, stderr progress and signals. Precommit cancellation rolls back safely; postcommit remains committed. Recovery/rollback can exceed deadlines; close waits rather than cancelling.

Ordinary v2/upgrade v3/Home-Journal-Bundle v1 remain, with separate maintenance plans/journals. Signature changes still require authorized upgrades. See [retention](../../engineering/maintenance-retention.en.md) and [controls](../../engineering/operation-control.en.md). Historical candidate evidence cannot establish freshness for a future publication; regenerate evidence under [procedures](../../guides/releasing.en.md).
