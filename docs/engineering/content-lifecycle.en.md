---
title: Content Inventory and Exact Repair
status: current
owner: project-maintainers
updated: 2026-10-09
---

# Content Inventory and Exact Repair

[中文主版本](content-lifecycle.md)

Applies to 1.3.0. See [content.ts](../../src/application/content.ts), [restore.ts](../../src/application/restore.ts), and the [content model](../../src/domain/content.ts).

Content is keyed by digest with an inventory and exact origins (coordinate, commit, snapshot). Active installations determine references; upgrades retain old digests. Cleanup removes only registered, unreferenced content validated at execution. Missing directories may have records removed; modified/unregistered content is retained and reported. Caches, revisions and user quarantines are outside cleanup.

Repair pins installed digest/commit without upgrading or resolving dependencies again. Missing content may be restored. Modified content requires restoreContent/--restore-content, quarantining originals before restoration and retaining them after commit. overwriteOwned/--overwrite-owned authorizes identifiable shared keys/blocks only, not modified whole files/links.

Sources must remain trusted. Validate cache first or fetch the exact commit, never latest. Prepare outside write transactions; revalidate revision, trust, content, and targets inside. Quarantine, publication, target repair, and state share Journal. Precommit failures restore old content; postcommit retains correct content and evidence. External changes or unsafe special files preserve data and report conflicts.

Single-asset repair checks the selected asset, expanding shared digests to related placements. Local success is not whole-Home health. Repair --all deduplicates digests and repairs all active assets in one transaction, excluding coordinate/placement selection. Any unverifiable restoration prevents publication.

contentChanges reports digests, actions, bytes, affected assets, recovery commits, and postexecution quarantine paths; list includes contents/quarantines. Doctor distinguishes missing, modified, unreferenced, unregistered, and quarantined content. Warning/info alone are not unhealthy; errors or incomplete inspection are. Experimental Homes missing inventory fields are rejected; unknown directories do not establish ownership.

See [recovery](../guides/recovery.en.md) and the [historical initiative](../initiatives/feature/content-lifecycle/README.en.md).
