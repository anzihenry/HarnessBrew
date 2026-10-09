---
title: Development and Delivery Validation
status: current
owner: project-maintainers
updated: 2026-10-09
---

# Development and Delivery Validation

[中文主版本](development.md)

Requires Node.js 22+, Git and npm. Source CI uses Node22/npm11.17.0 and Node24/npm12.0.2; official candidates pin Node22/npm11.17.0.

```sh
npm ci
npm run check:docs -- --structure-only
npm run test:docs
npm run check:architecture
npm run build
npm run test:fast
npm run release:verify
```

Authors use structure-only for preparation. After independent content/translation review and approval identity updates, run the full gates:

```sh
npm run check:docs
npm run check:all
```

Check includes docs, architecture, build, fast tests, versions; check:all adds packaged/regressions. Packaged tests share one candidate with private copies per test; HARNESSBREW_TEST_CANDIDATE may select an explicit candidate. Mock runtimes validate probe tooling, not authenticated Codex.

Behavior changes update affected docs/English, impact lists and independent review. Relevant changes invalidate old identities. Record new reviews in the active initiative and update the approval file consumed by checks. [Standard](../documentation.en.md) defines mandatory gates; [release procedures](releasing.en.md) cover same-package platform/real probes. Checker tests use temporary repositories to reject missing pairs, dates, links/anchors, status, indexes and stale approvals.
