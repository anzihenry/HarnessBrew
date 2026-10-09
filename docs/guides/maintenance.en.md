---
title: Maintenance and Operation Controls
status: current
owner: project-maintainers
updated: 2026-10-09
---

# Maintenance and Operation Controls

[中文主版本](maintenance.md)

## Cache maintenance and operation controls

Use `maintenance --dry-run --json` to save a reclamation preview, then `apply-maintenance <planId>` to apply exactly that preview. `recover-maintenance` resumes interrupted reclamation. This is separate from installed-content `cleanup`.

Default retention is 30 days, the newest 10 objects per category, and a 1 GiB reporting budget. Override it with `--ttl-days`, `--keep-newest`, and `--max-bytes`. CURRENT, recovery evidence, active leases, valid plan inputs, catalog/repair sources, and registered adapters take precedence over limits. Unknown objects and user quarantines are retained. Protected data may exceed the budget. Revisions are audit snapshots, not complete backups. Saved installation plans expire after 30 days; applying an expired plan returns `PLAN_STALE`, never an implicit replan.

SDK methods accept a separate final options argument:

```ts
const controller = new AbortController();
try {
  const preview = await harness.plan(request, {
    signal: controller.signal,
    timeoutMs: 30_000,
    onProgress: event => console.error(event.phase, event.completed),
  });
  const result = await harness.apply(preview.planId);
  console.log(result.outcome, result.maintenance, result.effects);
} finally {
  await harness.close();
}
```

`effects` is a discriminated union (`asset`, `metadata`, `adapter-upgrade`); legacy `changes` remains available. `outcome` distinguishes `committed` and `unchanged`; `maintenance: "recovery-required"` means a committed result needs cleanup, not a retry of the original mutation. Error recovery instructions identify `recover` or `recover-maintenance`.

Timeout starts at invocation. Pre-commit cancellation rolls back safely; recovery and rollback can exceed the deadline. Once committed, cancellation still returns the committed result. Synchronous work and plugin calls respond at the next safe checkpoint. Maintenance finishes its recoverable deletion once its intent is durable. `close()` rejects new work and waits for accepted operations and leases; it does not cancel them and is idempotent. Progress callback errors do not affect outcomes.

CLI `--progress` writes phase/count events to stderr; `--json` stdout remains one document. `--timeout-ms` sets the command deadline. SIGINT/SIGTERM request safe cancellation. Cancellation exits 130; timeout exits 124. Progress contains no paths, payloads, or credentials.
