---
title: SDK Operation Control Contracts
status: current
owner: project-maintainers
updated: 2026-10-09
---

# SDK Operation Control Contracts

[中文主版本](operation-control.md)

Applies to 1.3.0. See [operation-service.ts](../../src/application/operation-service.ts), [observation](../../src/observability/operation.ts), and [OperationOptions](../../src/application/types.ts).

OperationOptions is an independent final argument containing signal, timeoutMs, onProgress; it is not serialized into requests/plans/digests. Monotonic deadlines start at invocation; timeoutMs is an integer 0–2147483647. Zero timeout/pre-aborted signals fail before business I/O.

Progress carries phase and optional completed/total only. Phases: prepare, lock-wait, apply, recover, maintenance, complete; success ends with complete. Synchronous callback errors/Promise rejections are isolated; asynchronous observers are not awaited. Events exclude paths/content/secrets. Internal observers remain through an additive bridge. Apply counts persisted steps, recover counts reverted steps, maintenance counts finished objects; omit unreliable totals.

Cancellation propagates to preparation, Git process groups, and lock waits (default retry 50 ms). POSIX Git gets TERM, then KILL after 1 second if needed, with close awaited. Scans, synchronous parsing and plugins respond at the next safe checkpoint. Lease release and plan-reference/file publication are uncancellable short finalization.

Writes through persistent after-image are uncancellable. Safe points are prepared, before-write, after-record, before/after-state. Rollback/recovery mask triggered signals and may exceed deadlines. External changes blocking rollback report recovery needs/conflicts rather than ordinary cancellation. Durable committed locks the result; cancellation does not prevent cleanup. Maintenance cancels before durable intent, then finishes recoverable deletion.

Effects discriminate asset, metadata, adapter-upgrade; changes remains. Outcome is committed/unchanged and maintenance is complete/recovery-required. Metadata after uses the committed revision. Do not retry a committed write that needs cleanup; recovery.action distinguishes recover and recover-maintenance.

Services register tasks before callbacks. Close refuses new work, waits for accepted operations/rollback/lease release, returns the same Promise repeatedly, and does not cancel implicitly.

CLI --timeout-ms covers prerequisite queries and writes. --progress uses stderr, JSON stdout stays one document. SIGINT/SIGTERM request safe cancellation. Exit codes: cancellation 130, timeout 124, recovery needed 3.

See [maintenance/control examples](../guides/maintenance.en.md) and [development validation](../guides/development.en.md).
