---
title: File Locks and Cache Leases
status: current
owner: project-maintainers
updated: 2026-10-09
---

# File Locks and Cache Leases

[中文主版本](file-locks.md)

Applies to local macOS/Linux process coordination, relying on directory visibility and atomic rename; it is not a multi-host distributed lock. See [file-lock.ts](../../src/transactions/file-lock.ts) and [cache-leases.ts](../../src/application/cache-leases.ts).

## Lock protocol

Home, source caches and resources use withFileLock. Namespaces remain; an empty directory does not indicate ownership. Each call creates a unique `<pid>-<uuid>.json`, never reused.

The bakery algorithm atomically publishes ticket=null, scans the highest ticket, publishes the next decimal big integer, and waits for earlier (ticket, UUID) participants. Temporary files are fully written before rename. Release removes only the invocation's records, not the namespace or successors.

Confirmed dead PID records may be rechecked and removed. Live PIDs, permission uncertainty and PID reuse are protected; timeout returns LOCK_TIMEOUT rather than stealing by age. Unexplained published records return LOCK_CORRUPT and retain evidence. Legacy owner.json is incompatible; stop old processes before manual handling.

Transaction order is Home → user-wide external lock → sorted target locks. Preparation reads a snapshot and releases transaction locks before Git, plugin and content work. Commit reacquires locks and revalidates. Pending Journal blocks ordinary queries/previews.

## Leases and references

Consumers publish separate lease records under a short .leases.guard, then release the guard before work. Leases protect preparation through commit or durable preview-reference publication. Plans publish references before the plan; references protect inputs after process exit.

Consumers release transaction locks, then remove their leases under an uncancellable short guard. Release failures retain protection without replacing business errors or committed outcomes. Physical Home aliases share caches; historical roots receive separate leases/references.

Maintenance acquires Home → cache guard and rejects a stale plan immediately when a live lease exists rather than waiting for consumers. It retains the guard for validation/deletion. Corrupt references, unknown temporary objects, and unsafe paths remain. Old binaries do not register leases; do not collect during mixed-version operation. See [retention](maintenance-retention.en.md).

## Validation

[Lock](../../tests/locks.test.ts), [crash](../../tests/transaction-crash.test.ts), and [lease tests](../../tests/cache-leases.test.ts) cover process exclusion, SIGKILL during choosing/writing/release, live-PID protection, corruption, and persistent references. See [development](../guides/development.en.md).
