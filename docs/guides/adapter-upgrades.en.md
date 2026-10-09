---
title: Adapter Upgrade Procedure
status: current
owner: project-maintainers
updated: 2026-10-09
---

# Adapter Upgrade Procedure

[中文主版本](adapter-upgrades.md)

## Adapter upgrades

Inspect the candidate without importing its code. Inspection does not return an executable plan ID:

```sh
harnessbrew adapter inspect-upgrade openai-codex --module builtin:codex --json
```

Review the signature, versions, signature coverage and affected bindings, then explicitly authorize the digest and capabilities. For a third-party adapter, use its package directory instead of `builtin:codex`; only `link-directory` and `link-file` are allowed. Legacy declarations have no static capability field, so requiredCapabilities is null until authorized loading checks the actual export.

```sh
harnessbrew adapter upgrade openai-codex --module builtin:codex \
  --authorize-signature <signature-from-inspection> \
  --capability link-directory --capability link-file --capability write-file \
  --capability write-block --capability set-config \
  --bundle-file ./one/Harnessfile.yaml --bundle-file ./two/Harnessfile.yaml \
  --dry-run
harnessbrew apply-plan <plan-id>
```

Supply `--bundle-file` only for affected Bundles, once per checkout. Missing inputs return `LOCK_MISMATCH` with missingBindings. The SDK exposes `inspectAdapterUpgrade({name, module})` and `plan/execute({kind: "adapter.upgrade", name, module, authorizedSignature, capabilities, bundleFiles})`.

An upgrade pins installed asset commits, content and dependency closure, and replans only the selected adapter. Registration, targets and every affected Bundle lock commit in one transaction. It never implicitly upgrades assets or grants extra capabilities. Candidate drift returns `ADAPTER_CHANGED`; changed preview inputs reject commit. Shared edits preserve unrelated content. Operation-type changes on an existing resource, parent/child overlaps and unowned destinations can be rejected; there is no force bypass. Repeating an unchanged upgrade is idempotent.

Upgrade previews use saved-plan v3; ordinary previews remain v2. Home, Journal, Bundle lock and CLI result remain v1. Existing built-in registrations require explicit upgrade to adopt the new build-signature rule. Retain the old package and a consistent Home/targets/all-locks backup before upgrading. Third-party adapters can explicitly upgrade back to a retained old package. Downgrading the executable alone does not restore registration and targets; see [compatibility and rollback](../engineering/adapter-upgrades.en.md).
