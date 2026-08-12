# HarnessBrew 0.6.0 Release

`0.6.0` hardens HarnessBrew from a functional Target MVP into an automation- and extension-ready package manager. It adds durable mutation recovery, reproducible Harnessfile placements, explicit Tap trust, structured previews, and a trusted third-party Target Adapter lifecycle.

## Release contents

- strict Receipt and Cellar validation before destructive operations
- process-safe home and Target locks for concurrent mutations
- durable write-ahead journals with abandoned-operation recovery
- Harnessfile and lockfile v2 with structured user/project placements, portable paths, content digests, and Target convergence
- explicit Tap trust plus fast-forward-only updates and candidate rollback
- schema v1 JSON command envelopes and transactional `--dry-run` previews
- Target Adapter API v1 with validated, Cellar-bounded declarative plans
- `adapter add/list/remove` for trusted npm or local Adapter modules, with persisted identity verification
- packed-package installation smoke tests and synchronized npm/GitHub Release gates

## Release gate

Run from a clean checkout:

```bash
npm ci
npm run check
npm run release:verify -- v0.6.0
git diff --check
```

`npm run check` must pass the TypeScript 7.0 strict build, all tests, packed-package installation and public API imports, release source verification, and `npm pack --dry-run`.

Confirm that `package.json`, `package-lock.json`, `src/version.ts`, CLI tests, release tests, and `CHANGELOG.md` all identify `0.6.0`. The release tag must be exactly `v0.6.0`.

## Publication

Publication is a separate, explicitly confirmed operation:

1. Push the release commit to `main`.
2. Create and push annotated tag `v0.6.0`.
3. Publish the GitHub Release from that tag.
4. GitHub Actions checks out the exact tag, runs the full gate, builds one immutable tarball, and publishes that tarball as `harnessbrew@0.6.0` with npm provenance.
5. Verify the public registry artifact from a clean temporary prefix.

```bash
npm view harnessbrew@0.6.0 version dist.integrity dist.tarball
npm install --prefix /tmp/harnessbrew-0.6.0-install harnessbrew@0.6.0
/tmp/harnessbrew-0.6.0-install/node_modules/.bin/harnessbrew --version
```

The expected version output is `0.6.0`.

## Recovery

Do not move or overwrite a published tag. If publication fails before npm accepts the package, fix the workflow and rerun it for the same GitHub Release. If npm has already accepted the package, prepare a new patch version; published npm versions and Git tags remain immutable.
