---
title: Previews, Diagnostics and Content Recovery
status: current
owner: project-maintainers
updated: 2026-10-09
---

# Previews, Diagnostics and Content Recovery

[中文主版本](recovery.md)

## Preview, recovery, and JSON

Preview may populate isolated source/plan caches next to the Home, but does not initialize a new Home, grant trust, write a Bundle lock, or alter targets. Saved plans are local to that Home; changed revisions, targets, input manifests, or plugins cause rejection. No arbitrary operation JSON is accepted.

Git/source preparation, plugin preparation and content staging happen outside transaction write locks. Commit rechecks all prepared evidence. If concurrent changes invalidate a preview (`PLAN_STALE`), rerun the original command with `--dry-run` and apply the new plan ID; there is no automatic replan. Saved-plan v1 previews must be regenerated for v2. Home/Journal and public JSON formats remain v1. First-time preview leaves Home uninitialized; a competing initialization can invalidate it.

Process leases and durable preview references protect caches, including historical cache roots. Path aliases to the same physical Home share cache protection. Do not manually remove caches in use. Use a maintenance preview and explicit application for cache reclamation. Applying a plan can consume its staged content; regenerate the preview if staging is unavailable when retrying. See [architecture](../engineering/architecture.en.md) for execution and recovery boundaries.

Home state uses `CURRENT` and immutable `revisions/` snapshots. Content lives in `content/<digest>/`. Transactions record before/after evidence in `transaction.json`. Pending recovery blocks ordinary reads and previews. `doctor` can report partial diagnostics, while `recover` verifies ownership before restoring or cleaning up. Orphan deletion uses a verified quarantine that can resume after interruption.

Modified links and whole files are preserved even with `--overwrite-owned`; their continued ownership cannot be proved from a pathname. Shared key/block repair requires explicit overwrite and recognizable ownership. Damaged content is reported rather than silently replaced.

JSON stdout contains one `harnessbrew.result` version 1 document, with `ok`, `command`, `mode`, `result` or `error`, and `diagnostics`. Exit codes: 0 success, 1 business failure/unhealthy diagnosis, 2 argument/format error, 3 recovery needed/conflict, 4 unexpected failure.

## Content reclamation and restoration

Home `contents` records managed inventories and exact provenance by digest. Active installs determine references; upgrades retain old digest records. `cleanup --dry-run --json` previews unreferenced content reclamation. Cleanup forgets missing unreferenced directories, preserves modified and unregistered content, and does not delete historical revisions, source caches or repair quarantines.

`repair <asset>` restores missing content and targets from the installed commit, without upgrading. When the source cache is missing or damaged, it fetches that exact commit into an isolated cache. Sources must remain trusted. Preparation happens outside the write transaction; execution rechecks revision and content evidence.

Use `repair <asset> --restore-content` to explicitly preserve modified content in quarantine and restore verified bytes. `--overwrite-owned` separately authorizes shared target key/block repair. Unsupported special files stop restoration for inspection. The same digest is restored once for all active references.

Preview and execution `contentChanges` include digest, action, file byte count, affected assets and recovery commit. Completed restoration also reports quarantine paths. SDK requests use `restoreContent: true`; `query({kind: "list"})` includes `contents` and `quarantines`.

Doctor distinguishes missing, modified, unreferenced, unregistered and quarantined content. Informational/warning findings alone do not make the report unhealthy; errors or incomplete inspection do. Quarantines are preserved for manual review and disposal.

Home now requires `contents` and `quarantines`; earlier experimental Homes are not migrated. Use a fresh Home and preserve old data for inspection.

See [operation controls](../engineering/operation-control.en.md) for cancellation and the complete exit-code behavior.

## Content recovery sequence

```sh
harnessbrew cleanup --dry-run --json
harnessbrew apply-plan <plan-id>
harnessbrew doctor
harnessbrew repair team/assets/review --dry-run --json
# Modified content requires explicit authorization; originals are retained
harnessbrew repair team/assets/review --restore-content
```
