# HarnessBrew 0.7.1 Release Plan

`0.7.1` is a compatibility and trust-hardening patch release. It keeps the 0.7.0 product surface unchanged while making artifact production deterministic across the supported development toolchains and detecting Adapter entry-point content drift before execution.

## Acceptance criteria

- source checks pass on Node.js 22 with npm 11.17.0 and Node.js 24 with npm 12.0.2
- release candidates and cross-platform gates use Node.js 22 with npm 11.17.0
- artifact construction accepts the JSON shapes emitted by npm 11 and npm 12
- concurrent artifact builds serialize without missing-lock races
- newly trusted Adapter records contain an entry-point SHA-256 digest
- changed Adapter entry points fail closed before module execution
- legacy Adapter records without a digest remain readable and retain identity validation
- package metadata, source version, lockfile, changelog, and release tag agree on `0.7.1`

## Verification

```bash
npm ci
npm run check
git status --short
```

Build the immutable candidate through the Release candidate workflow, then follow [release-runbook.md](release-runbook.md) for deterministic gates, authenticated runtime verification, and publication.
