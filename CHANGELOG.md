# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Changed

- upgrade GitHub CI and release workflows to `actions/checkout@v6` and `actions/setup-node@v6` while keeping HarnessBrew builds on Node.js 22

## 0.6.0 - 2026-08-13

### Added

- add a versioned JSON CLI envelope with command-level results and structured errors
- add transactional `--dry-run` previews that report path fingerprints and roll back all managed changes
- add Target Adapter API v1 with validated registration, Cellar-bounded symlink plans, transaction-managed execution, and lockfile version fingerprints
- add explicit CLI management for trusted Adapter modules with persisted identity verification and transactional previews

### Security

- validate complete Receipt structures, canonical Cellar locations, operation metadata, owned keys, and all destructive paths before use
- detect added, removed, modified, unsupported, and permission-changed Cellar files through exact inventory comparison
- prevent forced cleanup from recursively deleting a real directory that replaced a managed directory symlink
- serialize CLI mutations per HarnessBrew home and protect shared Target configuration updates across processes
- recover interrupted mutations from durable write-ahead journals, including abandoned process locks and external Target files
- add Harnessfile and lockfile v2 with structured scopes, portable paths, content digests, explicit lock refresh, and Target convergence
- require explicit Tap trust before Target activation, enforce fast-forward updates by default, and roll back invalid Tap candidates

## 0.5.2 - 2026-08-13

### Fixed

- automated publication now passes npm an explicit local tarball path instead of a Git dependency specifier
- release tests guard the exact artifact handoff between `npm pack` and `npm publish`

## 0.5.1 - 2026-08-13

### Fixed

- npm package metadata now preserves the `harnessbrew` executable mapping in the published tarball
- package smoke tests run in clean CI environments without requiring an already-populated offline cache
- release automation checks out and validates the exact release tag, builds one immutable tarball, and publishes that same artifact with provenance
- release version consistency is now covered by an automated check across package metadata, source, changelog, and Git tags

## 0.5.0 - 2026-08-13

### Added

- explicit capability matrix and pure installation planners for OpenAI Codex and Claude Code
- receipt schema v2 with transactional `symlink-directory`, `symlink-file`, `render-file`, `managed-block`, and `merge-config` operations
- target-native Agent rendering, Workflow/Prompt-to-Skill projection, managed Instruction installation, and key-owned MCP configuration merging
- user and project target scopes, including multiple placements of the same Formula on one Target
- `doctor` integrity diagnostics and `relink` repair commands
- end-to-end integration coverage across every supported Formula, Target, and scope combination

### Changed

- Skill installation now links the complete directory so scripts, references, and other relative resources remain available
- Target identity is now based on Target plus destination instead of Target name alone
- upgrades regenerate every recorded Target placement and preserve unrelated user configuration
- MCP Formula entries use a portable JSON model whose credentials reference environment variable names only

### Fixed

- shared `AGENTS.md`, Codex TOML, and Claude JSON updates preserve user-owned content during link, upgrade, unlink, and rollback
- modified or missing rendered files, links, managed blocks, and configuration keys are detected before destructive operations
- Adapter Formula linking now fails explicitly instead of falling back to guessed `${kind}s` directories

## 0.4.0 - 2026-08-12

### Added

- Git Tap registration, validation, updates, commit checkout, and removal
- Formula catalog for skills, agents, workflows, instructions, prompts, MCP configurations, and adapters
- dependency resolution, conflict detection, immutable Cellar installs, and SHA-256 receipts
- OpenAI Codex and Claude Code target linking with ownership and tamper checks
- `update`, `outdated`, and rollback-safe `upgrade` commands
- Git-reproducible `Harnessfile`, `Harnessfile.lock`, `bundle install`, and `bundle cleanup`
- TypeScript 7.0 strict builds, comprehensive tests, npm packaging, and GitHub release automation

### Changed

- redefined HarnessBrew as a Git-native package manager for AI Agent assets
- moved version history from per-asset snapshots to Tap commits and tags
- raised the minimum supported Node.js version to 20

### Removed

- repository-owned sample assets and the obsolete workspace/export architecture

## 0.3.0 - 2026-06-27

### Added

- asset maintenance commands: `set`, `add-dependency`, `remove-dependency`, `clone`, and `archive`
- dependency graph commands: `deps`, `dependents`, `orphans`, and `impact`
- bundle `checksums.json` generation plus manifest digest metadata for release artifact verification
- `verify-bundle` command for validating required bundle files, SHA-256 digests, and asset payload consistency
- `pack --channel draft|stable`, with `stable` bundles requiring workspace validation before packaging
- `pack --archive` for producing distributable `.tar.gz` bundle archives
- `docs/walkthrough-asset-to-bundle.md` covering asset creation through bundle verification
- `docs/release-0.3.0.md` with version touchpoints, verification commands, manual checks, and release flow

### Changed

- repository sample agent now declares dependencies that match the initialized sample workspace
- asset metadata now includes `status: "active" | "archived"` and `list --status` filtering
- README command surface now reflects the `0.3.0` asset lifecycle, dependency graph, and bundle verification workflows
- smoke coverage now exercises lifecycle commands, graph queries, bundle digests, bundle verification, release channels, and archive packaging

### Fixed

- archive flow now blocks assets that are still depended on, avoiding broken dependency graphs
- bundle verification now catches missing files, checksum mismatches, and manifest/assets asset set drift

## 0.2.0 - 2026-06-17

### Added

- asset dependency modeling with validation for missing, duplicate, cyclic, and target-incompatible dependencies
- `show --resolved` for inspecting dependency trees and flattened dependency graphs
- filtered and grouped `list` output with `--kind`, `--tag`, `--owner`, `--target`, and `--group-by`
- structured `--json` output for `list`, `validate`, `history`, `diff`, `export`, and `pack`
- entry-scoped exports with `--entry <kind:id>` and optional `--include-dependencies`
- `pack` command for bundle delivery with `manifest.json`, `assets.json`, and `rendered/<target>.json`
- workspace-level `schemaVersion` and `bundleDirectory` configuration
- `0.2.0` roadmap documentation covering milestones, command design, and bundle packaging direction

### Changed

- strengthened target compatibility enforcement during export and pack flows
- expanded smoke coverage for dependency resolution, local adapter compatibility, scoped exports, and bundle generation
- updated README and architecture docs to reflect the `0.2.0` asset, export, and packaging model

## 0.1.1 - 2026-06-17

### Added

- `harness --version` support for checking the CLI release version directly
- release-facing documentation for version visibility and pre-release verification

### Changed

- stricter workspace validation for timezone presence, history integrity, compatibility target duplication, and snapshot consistency
- clearer `diff` output with metadata-field change summaries
- clearer `history` output with current-version markers and snapshot paths
- more focused `show` output with `--metadata` and `--content` modes
