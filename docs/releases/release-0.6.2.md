# HarnessBrew 0.6.2 Release

`0.6.2` is a documentation privacy patch. It removes personal account identifiers from the current English and Simplified Chinese README and architecture examples, replacing them with neutral `your-name` placeholders.

## Release contents

- anonymize Tap names, Formula coordinates, Git URLs, Cellar paths, and Receipt paths in public examples
- keep the English and Simplified Chinese documentation editions synchronized
- preserve all command and configuration semantics while making placeholder values explicit

There are no runtime behavior changes relative to `0.6.1`.

## Release gate

Run from a clean checkout:

```bash
npm ci
npm run check
npm run release:verify -- v0.6.2
git diff --check
```

Confirm that `package.json`, `package-lock.json`, `src/version.ts`, CLI tests, release tests, and `CHANGELOG.md` all identify `0.6.2`. The release tag must be exactly `v0.6.2`.

## Publication

1. Push the release commit to `main`.
2. Create and push annotated tag `v0.6.2`.
3. Publish the GitHub Release from that tag.
4. GitHub Actions checks out the exact tag, runs the complete release gate, builds one immutable tarball, and publishes `harnessbrew@0.6.2` to npm with provenance.
5. Verify the registry artifact from a clean temporary prefix.

```bash
npm view harnessbrew@0.6.2 version dist.integrity dist.tarball
npm install --prefix /tmp/harnessbrew-0.6.2-install harnessbrew@0.6.2
/tmp/harnessbrew-0.6.2-install/node_modules/.bin/harnessbrew --version
```

The expected version output is `0.6.2`.

## Recovery

Do not move or overwrite the published tag. If publication fails before npm accepts the package, fix the workflow and rerun it for the same GitHub Release. If npm has already accepted the package, prepare a new patch version; published npm versions and Git tags remain immutable.
