# HarnessBrew 0.5.2 Release

`0.5.2` fixes the automated artifact handoff exposed by the first `0.5.1` GitHub Release run. npm interpreted a relative tarball path without a `./` prefix as a Git dependency specifier, so the workflow now publishes an explicit local path and tests that invariant.

## Verification

```sh
npm ci
npm run check
npm run release:verify -- v0.5.2
```

The release workflow must complete successfully, publish with npm provenance, and pass a clean registry installation:

```sh
npm view harnessbrew@0.5.2 version dist.integrity dist.tarball
npm install --prefix /tmp/harnessbrew-0.5.2-install harnessbrew@0.5.2
/tmp/harnessbrew-0.5.2-install/node_modules/.bin/harnessbrew --version
```
