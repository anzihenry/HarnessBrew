# HarnessBrew 0.6.1 Release

`0.6.1` aligns HarnessBrew's supported runtime and public documentation after the `0.6.0` hardening release. It standardizes on Node.js 22, upgrades the GitHub Actions runtime, and reorganizes the documentation into a bilingual current reference with a focused release archive.

## Release contents

- Node.js 22 or later is required consistently by npm metadata, CI, and installation documentation
- CI and release workflows use `actions/checkout@v6` and `actions/setup-node@v6`
- English is the default language for the README and architecture guide, with complete Simplified Chinese editions alongside them
- current release notes live under `docs/releases`; obsolete roadmaps, task breakdowns, and the legacy asset-to-bundle walkthrough are removed
- both README editions expose CI, npm version, Node.js support, and license badges

There are no runtime behavior changes relative to `0.6.0` beyond the minimum supported Node.js version.

## Release gate

Run from a clean checkout:

```bash
npm ci
npm run check
npm run release:verify -- v0.6.1
git diff --check
```

Confirm that `package.json`, `package-lock.json`, `src/version.ts`, CLI tests, release tests, and `CHANGELOG.md` all identify `0.6.1`. The release tag must be exactly `v0.6.1`.

## Publication

1. Push the release commit to `main`.
2. Create and push annotated tag `v0.6.1`.
3. Publish the GitHub Release from that tag.
4. GitHub Actions checks out the exact tag, runs the complete release gate, builds one immutable tarball, and publishes `harnessbrew@0.6.1` to npm with provenance.
5. Verify the registry artifact from a clean temporary prefix.

```bash
npm view harnessbrew@0.6.1 version dist.integrity dist.tarball
npm install --prefix /tmp/harnessbrew-0.6.1-install harnessbrew@0.6.1
/tmp/harnessbrew-0.6.1-install/node_modules/.bin/harnessbrew --version
```

The expected version output is `0.6.1`.

## Recovery

Do not move or overwrite the published tag. If publication fails before npm accepts the package, fix the workflow and rerun it for the same GitHub Release. If npm has already accepted the package, prepare a new patch version; published npm versions and Git tags remain immutable.
