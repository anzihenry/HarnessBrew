# HarnessBrew

English | [简体中文](README.zh-CN.md)

HarnessBrew manages AI agent assets from Git repositories. It resolves dependencies, plans changes, and delivers skills, agents, workflows, prompts, instructions, and MCP configuration to Codex.

**This checkout prepares 1.0.0 with the new architecture and command/API contracts.** The legacy backend has been removed. See the [breaking changes and release checklist](docs/releases/release-1.0.0.md). Existing Homes, manifests, Formulae, and plugins are not migrated; use an empty Home with new format declarations.

## Run from source

Requires Node.js 22+ and Git.

```bash
npm ci
npm run build
node dist/bin.js help
```

The examples below use `harnessbrew` for the built executable. Set `--home /absolute/path` or `HARNESSBREW_HOME` to select a Home; the default is `~/.harnessbrew`.

## Quick start

```bash
harnessbrew tap add team/assets https://example.com/team/assets.git
harnessbrew tap trust team/assets
harnessbrew search review
harnessbrew install team/assets/review --scope project --project .
harnessbrew doctor

harnessbrew tap update team/assets
harnessbrew upgrade team/assets/review --dry-run --json
harnessbrew apply-plan <plan-id>

harnessbrew remove team/assets/review
harnessbrew cleanup
```

`tap add` registers an untrusted source. Trust must be granted explicitly before activation. Removing a root preserves assets required by other roots or Bundles. Unreferenced content becomes orphaned and is reclaimed by `cleanup` after inventory verification.

## Commands

| Commands | Behavior |
| --- | --- |
| `tap add <name> <git> [--ref <ref>]` | Register a verified Git snapshot |
| `tap update [name] [--ref <ref>] [--allow-rewind]` | Refresh candidates without upgrading installs |
| `tap trust/untrust/remove <name>`, `tap list` | Manage local source authorization |
| `install <asset>`, `upgrade [asset]`, `remove <asset>` | Manage manual root requirements and their dependency closure |
| `link/unlink <asset>` | Add/release a manual root's placement |
| `bundle apply --file <path> [--update-lock]` | Reconcile one Bundle binding and its portable lock |
| `bundle detach --binding <id>` | Release a binding, including when its manifest is gone |
| `repair <asset> [--restore-content] [--overwrite-owned]` | Restore exact installed content and missing targets; modified content is quarantined, target overwrite remains limited to shared keys/blocks |
| `cleanup`, `recover`, `doctor [asset]` | Reclaim orphan content, recover a transaction, or inspect consistency |
| `list`, `search [text]`, `info <asset>`, `outdated` | Query committed state and candidate snapshots |
| `adapter add <directory> --capabilities link-directory,link-file` | Authorize and load an already installed plugin |
| `adapter remove <name>`, `adapter list` | Manage adapters; active placements prevent removal |
| `apply-plan <id>` | Apply a host-saved plan without replanning |

All commands support `--home` and `--json`. Changes support `--dry-run`; recovery and applying an existing plan do not. Placement options are `--target` (default `openai-codex`), `--scope user|project` (default user), `--project`, and `--root`. Ambiguous existing placements require explicit selection. Unknown/repeated options are errors. Old aliases such as `uninstall`, `relink`, and `bundle install` are removed.

## Source format

```text
repository/
  tap.json
  assets/review/asset.json
  assets/review/SKILL.md
```

`tap.json`:

```json
{ "format": "harnessbrew.tap", "version": 1 }
```

`asset.json`:

```json
{
  "format": "harnessbrew.asset", "version": 1,
  "kind": "skill", "entry": "SKILL.md", "description": "Review changes",
  "dependencies": [], "conflicts": [], "targets": ["openai-codex"]
}
```

`SKILL.md` needs frontmatter with `name: review` and a nonempty `description`. Dependencies and conflicts use complete `owner/tap/asset` coordinates. Asset content inventories reject symlinks and escaping paths. Content bytes, paths, and permissions participate in its digest.

## Bundles

```yaml
format: harnessbrew.manifest
version: 1
id: team-tools
sources:
  - name: team/assets
    git: https://example.com/team/assets.git
    ref: main
assets:
  - coordinate: team/assets/review
    placements:
      - target: openai-codex
        scope: project
        project: .
```

`bundle apply --file Harnessfile.yaml` writes `Harnessfile.yaml.lock.json` in the same transaction as the installation. Subsequent applies use its exact versions. Changing the manifest or adapter signatures requires `--update-lock`. The manifest cannot grant trust. Checkouts have independent bindings; binding IDs are available from `list`. A single Home permits one active version per coordinate and rejects conflicting owners.

## SDK and plugins

```ts
import { createHarness } from "harnessbrew";

const harness = createHarness({
  home: "/work/harness-home", cwd: "/work/project", userHome: "/home/me"
});
try {
  const preview = await harness.plan({
    kind: "asset.install", coordinate: "team/assets/review",
    placements: [{ target: "openai-codex", scope: "project", projectRoot: "/work/project" }]
  });
  await harness.apply(preview.planId);
  const installed = await harness.query({ kind: "list" });
} finally {
  await harness.close();
}
```

The SDK also exposes `execute`, `recover`, and `doctor`. `HarnessError` has a stable `code`, `details`, `cause`, and recovery guidance. CLI and SDK use the same service. Internal storage and transaction functions are not public SDK exports.

Plugin types come from `harnessbrew/adapter`. Plugins default-export a `TargetAdapter` with protocol `harnessbrew.adapter/1`. Their `package.json` includes:

```json
{
  "type": "module",
  "harnessbrew": {
    "format": "harnessbrew.adapter-package", "version": 1,
    "name": "my-adapter", "adapterVersion": "1", "entry": "index.mjs"
  }
}
```

The signed directory must contain its dependencies and `package-lock.json` when dependencies are declared; symlinks are rejected. Bundled plugins are simplest. Third-party capabilities are limited to links. Previewing a new registration reads declarations without importing code; authorized execution verifies the signature and export, then imports a verified copy. Plugins run as host code, not in a sandbox.

## Preview, recovery, and JSON

Preview may populate isolated source/plan caches next to the Home, but does not initialize a new Home, grant trust, write a Bundle lock, or alter targets. Saved plans are local to that Home; changed revisions, targets, input manifests, or plugins cause rejection. No arbitrary operation JSON is accepted.

Home state uses `CURRENT` and immutable `revisions/` snapshots. Content lives in `content/<digest>/`. Transactions record before/after evidence in `transaction.json`. Pending recovery blocks ordinary reads and previews. `doctor` can report partial diagnostics, while `recover` verifies ownership before restoring or cleaning up. Orphan deletion uses a verified quarantine that can resume after interruption.

Modified links and whole files are preserved even with `--overwrite-owned`; their continued ownership cannot be proved from a pathname. Shared key/block repair requires explicit overwrite and recognizable ownership. Damaged content is reported rather than silently replaced.

JSON stdout contains one `harnessbrew.result` version 1 document, with `ok`, `command`, `mode`, `result` or `error`, and `diagnostics`. Exit codes: 0 success, 1 business failure/unhealthy diagnosis, 2 argument/format error, 3 recovery needed/conflict, 4 unexpected failure.

## Development

```bash
npm run check:all
```

This runs the build, fast tests, package tests against one candidate, and historical regressions now exercised through the new service. Legacy backend tests have been removed; regression coverage uses the new service. Runtime preflight tests use a fake runtime; real Codex acceptance is a separate environment-dependent release check.

See the [architecture decisions](docs/design/refactor-architecture.zh-CN.md), [contracts](docs/design/refactor-contracts.zh-CN.md), and [phase 6 implementation](docs/design/phase6-implementation.zh-CN.md).

## License

MIT.

## Content reclamation and restoration

Home `contents` records managed inventories and exact provenance by digest. Active installs determine references; upgrades retain old digest records. `cleanup --dry-run --json` previews unreferenced content reclamation. Cleanup forgets missing unreferenced directories, preserves modified and unregistered content, and does not delete historical revisions, source caches or repair quarantines.

`repair <asset>` restores missing content and targets from the installed commit, without upgrading. When the source cache is missing or damaged, it fetches that exact commit into an isolated cache. Sources must remain trusted. Preparation happens outside the write transaction; execution rechecks revision and content evidence.

Use `repair <asset> --restore-content` to explicitly preserve modified content in quarantine and restore verified bytes. `--overwrite-owned` separately authorizes shared target key/block repair. Unsupported special files stop restoration for inspection. The same digest is restored once for all active references.

Preview and execution `contentChanges` include digest, action, file byte count, affected assets and recovery commit. Completed restoration also reports quarantine paths. SDK requests use `restoreContent: true`; `query({kind: "list"})` includes `contents` and `quarantines`.

Doctor distinguishes missing, modified, unreferenced, unregistered and quarantined content. Informational/warning findings alone do not make the report unhealthy; errors or incomplete inspection do. Quarantines are preserved for manual review and disposal.

Home now requires `contents` and `quarantines`; earlier experimental Homes are not migrated. Use a fresh Home and preserve old data for inspection.
