# 1.2.0 candidate — architecture batch B

Status: candidate acceptance in progress; not published. The version was absent from the public npm registry on 2026-10-07.

This adds explicit Adapter upgrades for manual installs and all affected Bundle checkouts. Static inspection returns candidate identity and scope without import. An exact digest/capability grant authorizes candidate planning; one transaction commits registration, targets and every lock. Installed asset pins remain unchanged. The SDK and CLI examples are in the [README](../../README.md#adapter-upgrades).

Saved upgrade previews use v3; ordinary previews stay v2. Home, Journal, Bundle lock and CLI result remain v1. The built-in signature rule changes to emitted runtime closure plus production dependency lock, requiring an explicit built-in upgrade even if its implementation version is unchanged. No active Home migration is introduced. See [format evidence](../design/batch-b-compatibility.zh-CN.md).

Retain the prior package and a consistent offline backup of Home, managed targets and all affected Bundle locks. A binary downgrade alone does not reverse registration and target changes. Third-party packages can be explicitly upgraded back with every affected Manifest; built-in rollback requires a suitable compatible build or consistent backup restoration. Preserve pending journals and recover before switching or restoring anything. Old previews are not backups.

The local candidate acceptance includes an actual installation created by the retained A 1.1.0 package, upgrade by this candidate, old-format reader checks and offline consistent backup restoration. Its report will record both package digests. It is a temporary fixture rehearsal, not a backup of a user's active Home.

Production publication remains separate and must use the [protected release workflow](release-runbook.md), its prescribed toolchain, same-run evidence and deployment approval. Local Docker/runtime reports do not replace production evidence provenance.
