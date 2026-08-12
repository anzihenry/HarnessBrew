# HarnessBrew 0.5.1 Release

`0.5.1` restores a one-to-one relationship between the Git tag, GitHub Release, and npm package after the `0.5.0` package smoke and executable metadata fixes landed after the `v0.5.0` tag.

## Release guarantees

- `package.json`, `package-lock.json`, `src/version.ts`, and `CHANGELOG.md` declare the same version.
- the GitHub Actions job checks out the exact published release tag.
- CI runs the full build, test, package smoke, and release-source verification suite.
- one tarball is produced from the tagged source and that exact tarball is published to npm with provenance.
- published tags and npm versions remain immutable; a defect is fixed with another patch release.

## Pre-release verification

```sh
npm ci
npm run check
npm run release:verify -- v0.5.1
git status --short
```

## Publication

1. Push the release commit to `main`.
2. Create and push the annotated `v0.5.1` tag at that commit.
3. Publish a GitHub Release from exactly that tag.
4. Let `.github/workflows/release.yml` publish the verified tarball through npm Trusted Publishing.

The npm package must configure this repository and `.github/workflows/release.yml` as its Trusted Publisher. No long-lived npm token is required by the workflow.

## Registry verification

```sh
npm view harnessbrew@0.5.1 version dist.integrity dist.tarball
npm install --prefix /tmp/harnessbrew-0.5.1-install harnessbrew@0.5.1
/tmp/harnessbrew-0.5.1-install/node_modules/.bin/harnessbrew --version
```

The installed executable must print `0.5.1`.
