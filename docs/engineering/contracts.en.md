---
title: Public Interfaces and Data Contracts
status: current
owner: project-maintainers
updated: 2026-10-09
---

# Public Interfaces and Data Contracts

[中文主版本](contracts.md)

Applies to source version 1.3.0. Authoritative public types are in [application/types.ts](../../src/application/types.ts), [root exports](../../src/index.ts), and the [Adapter protocol](../../src/adapter.ts).

## Public entry points

`harnessbrew` exports createHarness, HarnessError, VERSION, runCli and business types; `harnessbrew/adapter` supplies plugin contracts. Locks, Journal and Store implementations are not public SDK APIs.

Service methods are plan, execute, apply, query, doctor, recover, inspectAdapterUpgrade, planMaintenance, applyMaintenance, recoverMaintenance, and close. All except close accept independent OperationOptions. See [SDK usage](../guides/sdk.en.md) and [operation controls](operation-control.en.md).

Request kinds include tap.add/update/remove/trust/untrust, adapter.add/remove/upgrade, asset.install/upgrade/remove, placement.link/unlink, bundle.apply/detach, cleanup, and repair. Maintenance uses separate methods. Repair chooses a coordinate or all=true, never both; all cannot select a placement. Unknown fields are rejected.

## State and formats

Declarations strictly validate format/version; ownership is not inferred from old directories. Home, install/source/Adapter state, assets, snapshots, Manifest, Bundle lock, ChangePlan, Journal, and CLI result retain their individual v1 formats. Ordinary saved plans use v2, upgrade plans v3; maintenance plans/journals are separate. Saved-plan v1 returns PLAN_STALE and must be regenerated. Experimental Homes missing contents/quarantines are not automatically migrated.

Home holds CURRENT, immutable revisions, installation/source/Adapter state, contents inventory, and quarantines. Each active coordinate has one version. Separate usage requirements express roots, dependency closures, and placements. References must be complete. Content digests cover relative paths, bytes, directory entries and executable permissions, not timestamps or host absolute paths. Assets reject symlinks, special devices, and path escapes.

## Operations and ownership

Types are link-directory, link-file, write-file, write-block, set-config; remove-owned is derived from existing ownership. Adapters supply forward desired operations; Planner decides deletion. Capabilities, inventory source paths, target roots, overlap, and precondition fingerprints are validated.

Whole files/links own paths; shared blocks/configuration own specific addresses. Physical operations share references only when asset version, type, content, and ownership agree. JSON/TOML updates preserve unmanaged keys and comments. MCP stores environment-variable references, not secrets, in plans, journals, and locks.

## Bundles and results

Manifests use harnessbrew.manifest/1; trust comes only from local authorization. Locks contain declaration digests, pinned commits/content/dependencies, roots, portable placements, and Adapter signatures, not host Home/binding identities or secrets. Bindings use Manifest ID and canonical directory; checkouts are independent. Signature/declaration changes require explicit update-lock. See [upgrade contracts](adapter-upgrades.en.md) for coordinated upgrades.

PlanPreview contains planId, baseRevision, effects, changes, operations, fileUpdates, contentChanges, retained, and diagnostics. Execution distinguishes committed/unchanged and complete/recovery-required. Failures use HarnessError code, details, cause, and recovery, not natural-language parsing.

CLI stdout uses one harnessbrew.result/1 envelope; progress uses stderr. Basic exit codes: 0 success, 1 business failure/unhealthy diagnostics, 2 argument/format error, 3 recovery needed/conflict, 4 unexpected failure; cancellation 130, timeout 124. See [usage](../guides/using.en.md) and [recovery](../guides/recovery.en.md).
