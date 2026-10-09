---
title: Content Inventory and Exact Repair Delivery
status: completed
owner: project-maintainers
updated: 2026-10-09
---

# Content Inventory and Exact Repair Delivery

[中文主版本](README.md)

## Goal and scope

Register digest inventories, reclaim unreferenced content safely, and restore exact installed commits/placements while retaining modified originals in quarantine. Completion covers shared digests, revoked trust, stale previews, rollback and CLI/SDK parity.

## Implementation and historical validation

The 2026-10-05 record identifies contracts 9ad0c50, inventory 4e729d7, cleanup 7f51ee6, preparation 15f19a8, transactions d252e45, CLI/SDK 15488a1. Acceptance fixed multi-snapshot Catalog ordering and shared-digest source preparation.

Local development candidate 1.0.0 used base 15488a1b1155ac8b8cc60f53391a5446d2583e42, dirty=true, SHA-256 b92dd902bb9a04a689e4d1185804a2a27097be3dccd4e9ad4ec732d2b3a9eddb. Fast 162, packaged 19, regressions 3, Linux/macOS five scenarios and retried Codex 0.160.0 four probes passed. Initial agent/MCP failures had no established cause. Reports lived in ignored local artifacts, not clean release evidence.

Coverage included retained old digests, shared references, missing/modified/unknown content, exact commits, unavailable caches, SIGKILL around quarantine/state writes, external conflicts and retained originals. Not published.

## Completion and current references

Historical goals are complete; [content contracts](../../../engineering/content-lifecycle.en.md) and [recovery](../../../guides/recovery.en.md) describe current behavior. See [usage](../../../guides/using.en.md) for repair-all and default-branch tracking. This entry is the sole historical status location. Partial success is not whole-Home health; old experimental Homes are not migrated. See [migration review](../../process/documentation-standard/validation.en.md).
