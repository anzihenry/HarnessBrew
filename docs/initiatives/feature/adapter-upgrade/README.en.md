---
title: Atomic Adapter Upgrade Delivery
status: completed
owner: project-maintainers
updated: 2026-10-09
---

# Atomic Adapter Upgrade Delivery

[中文主版本](README.md)

## Goal, scope and completion criteria

B01–B10 delivered static inspection, digest/capability grants, pinned-asset planning, and one transaction for manual installs/all affected Bundle checkouts. Completion requires consistent registration/placements/every lock and evidence for old readers, reverse third-party upgrades, crashes and backup rollback.

## Historical results and risks

Candidate 1.2.0 passed fast 243, packaged 19, regressions 3, Linux/macOS gates and four real Codex probes. Retained 1.1.0 actually created installations; 1.2.0 upgraded them jointly, then consistent backup restoration passed old-package doctor. [Version acceptance](../../../releases/1.2.0/validation.en.md) owns both digests and rehearsal results.

B08 compared strict v1 schemas against A base 384caa0, keeping Home/Journal/Bundle/ChangePlan fields unchanged; saved-plan v3 carries authorization/locks. The minimal A v2 fixture checks parsing, not execution on arbitrary hosts. See [current compatibility](../../../engineering/adapter-upgrades.en.md).

## Completion and current references

Historical goals are complete, not a publication claim. See [upgrade procedures](../../../guides/adapter-upgrades.en.md). Structural compatibility does not authorize old plugins with new registrations. Modified whole files/links are not forced over; unrecorded writes may need manual recovery. This entry owns historical status and links version evidence without duplication. See [migration review](../../process/documentation-standard/validation.en.md).
