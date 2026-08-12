# HarnessBrew 0.5.0 Release

`0.5.0` completes the first Target Adapter MVP: Git-managed Formula content can be installed once in the Cellar and projected safely into OpenAI Codex and Claude Code at user or project scope.

## Release contents

- deterministic Target capability matrix and planners
- transactional Receipt v2 operations with rollback and tamper detection
- complete-directory Skill links
- native Agent rendering for Codex TOML and Claude Markdown
- Workflow and Prompt projection as standard Skills
- managed Codex `AGENTS.md` blocks and Claude rules links
- key-owned Codex/Claude MCP configuration merging without plaintext secrets
- user/project scopes and multiple placements per Target
- `doctor` diagnostics and `relink` repair
- a 6 Formula × 2 Target × 2 scope integration matrix, plus Adapter rejection coverage

## Release gate

Run from a clean checkout:

```bash
npm ci
npm run check
git diff --check
```

`npm run check` must pass the TypeScript 7.0 strict build, all tests, the packed-package installation smoke test, and `npm pack --dry-run`.

Confirm the version is synchronized in `package.json`, `package-lock.json`, `src/version.ts`, the CLI version test, and this changelog. The release tag must be exactly `v0.5.0`.

## Publication

1. Push the release commit to `main`.
2. Create and push annotated tag `v0.5.0`.
3. Publish the GitHub Release from that tag.
4. The release workflow runs the full check, verifies tag/package version equality, and publishes `harnessbrew@0.5.0` to npm with provenance.
5. Verify a registry-backed installation in a new temporary directory:

```bash
npm view harnessbrew@0.5.0 version
npm install --prefix /tmp/harnessbrew-0.5.0-install harnessbrew@0.5.0
/tmp/harnessbrew-0.5.0-install/node_modules/.bin/harnessbrew --version
```

The expected version output is `0.5.0`.

## Recovery

Do not move or overwrite a published tag. If publication fails before npm accepts the package, fix the workflow and rerun it for the same GitHub Release. If a defect is found after npm publication, prepare a new patch release; npm package versions and published Git tags remain immutable.
