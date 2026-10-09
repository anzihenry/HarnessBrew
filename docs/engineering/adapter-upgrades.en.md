---
title: Adapter Upgrade and Compatibility Contracts
status: current
owner: project-maintainers
updated: 2026-10-09
---

# Adapter Upgrade and Compatibility Contracts

[中文主版本](adapter-upgrades.md)

Applies to 1.3.0. See the [use case](../../src/application/use-cases/adapter-upgrade.ts), [planner](../../src/planning/plan.ts), and [executor](../../src/execution/adapter-upgrade.ts).

Static inspect does not import or produce a planId; it reports digest, declaration, signature coverage and affected assets/bindings. Exact signature/capability authorization permits loading and planning; dry-run does not grant code execution. Third parties are limited to link-file/link-directory. Unknown static requiredCapabilities is null; verify exports after authorization.

Pin installed commits, digests and dependencies. Do not upgrade assets; reproject the selected Adapter only. Changed candidate returns ADAPTER_CHANGED. Missing affected checkout Manifests return LOCK_MISMATCH/missingBindings. Check IDs, physical directories, declaration digests, prior locks and closures; reject duplicate/extra inputs.

Old-to-new registration, targets, and every affected lock commit in one v1 Journal. Locks replace only the target Adapter signature; pins, dependencies, sources, roots, manifestDigest remain. Recovery uses state/before-after images, not old plugins. External changes preserve evidence and conflict; unrecorded writes do not promise automatic rollback.

Ordinary saved plans use v2, upgrades v3; Home/Journal/Manifest/Bundle lock/ChangePlan/CLI result retain individual v1 formats. Old v1 previews require regeneration; A readers reject v3. Authorization/lock updates live in saved-plan outer data, not strict ChangePlan v1 fields.

Built-in signatures use builtin-closure/1 over emitted runtime closure and production dependency lock, excluding docs/source maps/timestamps. An unchanged implementation version still requires explicit upgrade when signature changes. Third-party inventory includes dependencies/lock. Identity checks do not sandbox host JavaScript privileges.

Stop work and recover pending Journal before rollback. Third parties may explicitly authorize retained old packages with every Manifest. Downgrading binaries does not restore registration/targets. Built-in rollback requires a compatible build or consistent restoration of Home/all targets/locks. Revisions/previews are not full backups. See [upgrade instructions](../guides/adapter-upgrades.en.md) and [1.2.0 two-package acceptance](../releases/1.2.0/validation.en.md).
