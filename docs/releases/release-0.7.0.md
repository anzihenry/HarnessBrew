# HarnessBrew 0.7.0 Release Plan

`0.7.0` establishes a repeatable release-artifact verification system. The release must prove that the exact npm tarball selected for publication completes HarnessBrew's main lifecycle, and that the same candidate can be loaded by locally authenticated Codex and Claude Code installations before a human approves publication.

This release does not add a new Formula kind or built-in Target. Its product is a durable release gate with two complementary layers:

1. deterministic packaged-CLI end-to-end tests in GitHub Actions
2. local authenticated Agent runtime checks against the same candidate tarball

## Release invariants

The following requirements are non-negotiable:

- A release candidate is packed exactly once.
- The candidate tarball, its SHA-256 digest, source commit, and package version are recorded in a versioned artifact manifest.
- Package smoke tests and end-to-end tests accept an explicit tarball and never silently rebuild or repack it.
- Every end-to-end HarnessBrew command runs through the executable installed from that tarball, not through `src`, repository `dist`, or an imported internal API.
- Tests use isolated homes, Target roots, Git configuration, npm prefix, and project directories and never modify the developer's or runner's real Agent configuration.
- Linux and macOS verify the same candidate bytes.
- Local Codex and Claude Code runtime checks verify the same SHA-256 that passed deterministic CI.
- The publish job verifies the candidate digest and publishes that tarball without rebuilding or repacking it.

## Verification layers

### Source tests

The existing strict TypeScript build and integration suite continue to validate module behavior, transactions, locks, recovery, security boundaries, and release metadata. These tests run on every pull request.

### Deterministic artifact E2E

GitHub Actions installs the candidate tarball into a clean prefix and exercises the real `harnessbrew` binary. This layer does not use OpenAI or Anthropic credentials and does not invoke a model.

It must cover:

- package metadata, executable mapping, help, version, and public ESM exports
- Tap add/list/trust/update/remove, including invalid candidates and rewritten history
- Formula search/info, dependency installation, conflicts, and trust enforcement
- Cellar and Receipt creation and integrity
- Skill, Agent, Workflow, Prompt, Instruction, and MCP delivery to OpenAI Codex and Claude Code
- user and project scopes, including multiple placements of one Formula
- update, outdated, upgrade, Target preservation, and user-owned configuration preservation
- doctor findings for missing, modified, and Cellar-damaged assets
- relink repair and refusal to repair from a damaged Cellar
- Harnessfile v2 lock creation, exact reconstruction in another home, explicit lock refresh, convergence, and cleanup
- schema v1 JSON envelopes, error semantics, and transactional dry-run rollback
- unlink, uninstall, bundle cleanup, and Tap removal without managed residue

The Target placement contract contains 24 supported combinations:

```text
6 deliverable Formula kinds × 2 built-in Targets × 2 scopes
```

Adapter Formulas are tested separately: they may be installed in the Cellar but cannot be activated through a built-in Target.

### Local Agent runtime verification

Authenticated model execution is intentionally outside the unattended GitHub Actions gate. A release operator downloads the already verified candidate and runs local runtime probes using existing Codex and Claude Code authentication.

The runtime suite must:

- install test assets with the candidate's packaged `harnessbrew` executable
- isolate all test configuration and never overwrite real Agent assets
- explicitly invoke a nonce-bearing Skill
- verify a nonce-bearing Instruction enters the active context
- explicitly delegate to a nonce-bearing custom Agent and inspect structured events
- launch a local credential-free MCP fixture, observe its tool call, and verify its nonce
- record CLI versions, platform, candidate digest, per-probe status, and completion time
- avoid recording tokens, credentials, full user configuration, or hidden model reasoning

Codex and Claude Code probes report `passed`, `failed`, or `skipped`. Missing authentication is an environment skip during development, but both runtimes must pass before approving a production release.

## Failure classification

Runtime failures are classified so upstream instability is not confused with a HarnessBrew defect:

- `product-failure`: an asset is absent, invalid, undiscoverable, or connected to the wrong destination; blocks release
- `provider-failure`: rate limiting, upstream 5xx, network interruption, or temporary model unavailability; requires a retry and never counts as a pass
- `environment-failure`: missing or unsupported CLI, missing authentication, or pending workspace approval; requires local setup and a rerun
- `behavioral-failure`: the runtime loaded the asset but did not perform the explicitly requested action; retry once, then block release if it repeats

## Artifact manifest

Each candidate includes `artifact-manifest.json` and `SHA256SUMS`. The manifest schema begins at version 1 and records at least:

```json
{
  "schemaVersion": 1,
  "package": {
    "name": "harnessbrew",
    "version": "0.7.0",
    "filename": "harnessbrew-0.7.0.tgz",
    "sha256": "<hex digest>"
  },
  "source": {
    "commit": "<git commit>",
    "tag": "v0.7.0",
    "dirty": false
  },
  "runtime": {
    "node": "<version>",
    "npm": "<version>",
    "platform": "<platform>",
    "architecture": "<architecture>"
  },
  "createdAt": "<ISO-8601 timestamp>"
}
```

Candidate verification fails if the tarball digest, filename, package metadata, source identity, or expected version differs from the manifest.

## Required commands

The implementation must converge on three stable entry points:

```bash
# Fast source validation during development
npm run check

# Deterministic packaged release gate used by CI
npm run release:gate

# Local authenticated verification of an existing candidate
npm run release:preflight -- \
  --package /absolute/path/harnessbrew-0.7.0.tgz \
  --manifest /absolute/path/artifact-manifest.json
```

`release:preflight` must reject a missing candidate argument and must not build or pack a replacement.

## CI and publication workflow

Pull requests run source tests, build one candidate artifact, and run deterministic packaged E2E on Linux and macOS.

A release candidate workflow produces a downloadable tarball, manifest, checksum file, and deterministic E2E reports for a specific commit. The release operator then:

1. downloads that candidate
2. verifies its SHA-256 locally
3. runs the Codex and Claude Code runtime preflight
4. reviews the runtime evidence
5. approves the protected npm production environment

The publish job has the only npm trusted-publishing permission. It downloads the approved candidate, verifies version, tag, commit, and SHA-256, and invokes `npm publish` on the existing `.tgz`. It must not run `npm run build`, `prepack`, or `npm pack`.

After publication, a registry smoke job installs `harnessbrew@0.7.0` from npm into a clean prefix and verifies version, help, public imports, and a minimal local Tap lifecycle.

## Release acceptance checklist

### Source and artifact

- [ ] strict build and all source integration tests pass
- [ ] release source metadata identifies `0.7.0` and tag `v0.7.0`
- [ ] exactly one candidate tarball exists
- [ ] artifact manifest and `SHA256SUMS` match the tarball
- [ ] package smoke installs and runs the candidate executable

### Deterministic E2E

- [ ] Tap and Formula lifecycle passes through the packaged CLI
- [ ] all 24 supported Target placements pass
- [ ] user-owned configuration remains byte-for-byte intact
- [ ] update, outdated, upgrade, doctor, and relink pass
- [ ] Harnessfile reconstruction and cleanup pass across isolated homes
- [ ] dry-run leaves no persistent changes
- [ ] JSON success and failure contracts pass
- [ ] Linux and macOS validate the same SHA-256

### Local runtime

- [ ] Codex Skill, Agent, Instruction, and MCP probes pass
- [ ] Claude Code Skill, Agent, Instruction, and MCP probes pass
- [ ] runtime evidence records the candidate's exact SHA-256
- [ ] no credentials or user configuration are present in evidence or logs

### Publication

- [ ] protected production environment receives human approval
- [ ] publish job verifies candidate commit, tag, version, and digest
- [ ] publish job does not rebuild or repack
- [ ] npm publishes the approved candidate tarball with provenance
- [ ] registry smoke passes from a clean prefix

## Deferred scope

The following items are not required for `0.7.0`:

- Windows support
- private SSH Tap authentication
- external Git hosting failure injection
- performance or very large Tap benchmarks
- unattended model calls in pull-request or release Actions
- automatic interactive workspace trust or MCP approval

## Recovery

Do not move a published tag or overwrite a published npm version. If deterministic or local runtime validation fails before publication, fix the candidate source and produce a new candidate. If npm has accepted the version, prepare a new patch release rather than attempting to replace the artifact.
