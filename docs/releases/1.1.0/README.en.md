---
title: 1.1.0 Release Record
status: verified
owner: project-maintainers
updated: 2026-10-09
---

# 1.1.0 Release Record

[中文主版本](README.md)

Batch A passed local acceptance on 2026-10-07, not official publication. Git/plugin/content preparation moved outside transaction write locks. Commit retains complete revalidation, target locks and durable Journal; drift requires a new preview.

Ordinary saved plans use v2; v1 must be regenerated. Home/Journal/ChangePlan/Bundle/CLI retain individual v1 formats. Compatibility is relative to the content-lifecycle baseline, not experimental Homes missing inventories. Leases/durable references include historical roots. GC was deferred to later C; use current guides today.

Stop work/recover pending Journal before rollback and retain consistent Home/target/lock backups. Public 0.7.1 is not a v1 Home rollback. See [validation](validation.en.md) for digest, source and failure retries. Publication must again satisfy [protected procedures](../../guides/releasing.en.md); historical reports do not prove current freshness/production provenance.
