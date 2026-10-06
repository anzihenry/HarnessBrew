# 1.1.0 candidate — architecture batch A

Status: candidate validation in progress; not published. The version was absent from the public npm registry on 2026-10-06. Final evidence is tracked in the batch A task ledger and acceptance report.

Preparation of Git sources, adapter copies/imports and content now runs outside transaction write locks. Commit retains full freshness/integrity checks, target locks and durable journal publication. Concurrent changes return an error instead of silently changing the requested plan. Regenerate a stale preview, review it and apply its new ID.

Saved-plan v2 is a local reconstructible cache format. Found v1 previews return `PLAN_STALE`; regenerate them. Batch A does not change Home, Journal, ChangePlan, Bundle lock or public result v1 formats. This compatibility statement is relative to the batch A source baseline (`3b37a8c`); earlier experimental Homes lacking the content lifecycle fields are not migrated.

Cache leases cover running operations and durable preview references, including historical cache roots. Cache GC is deferred to batch C. Do not delete referenced/active caches or run a collector while mixing binary versions. An applied plan can consume its staging, so a retry may require a new preview.

## Rollback

Before switching binaries, stop active operations and use a compatible binary to recover any pending transaction. Keep the Home and target recovery evidence. Return to the verified pre-A build from source baseline `3b37a8c` if necessary; regenerate previews with that binary because it cannot read saved-plan v2. Do not treat the older public npm 0.7.1 package as a compatible rollback for v1 Homes. No active Home migration is introduced by batch A.

## Release boundary

Local and standalone candidate checks do not authorize publication. Production still requires the protected workflow, the same candidate digest across Linux/macOS and all four real Codex probes, fresh evidence and the existing deployment approval. See the [runbook](release-runbook.md).
