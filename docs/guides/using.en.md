---
title: Usage and Commands
status: current
owner: project-maintainers
updated: 2026-10-09
---

# Usage and Commands

[中文主版本](using.md)

## Commands

| Commands | Behavior |
| --- | --- |
| `tap add <name> <git> [--ref <ref>]` | Register a verified Git snapshot |
| `tap update [name] [--ref <ref>] [--default-branch] [--allow-rewind]` | Refresh candidates without upgrading installs |
| `tap trust/untrust/remove <name>`, `tap list` | Manage local source authorization |
| `install <asset>`, `upgrade [asset]`, `remove <asset>` | Manage manual root requirements and their dependency closure |
| `link/unlink <asset>` | Add/release a manual root's placement |
| `bundle apply --file <path> [--update-lock]` | Reconcile one Bundle binding and its portable lock |
| `bundle detach --binding <id>` | Release a binding, including when its manifest is gone |
| `repair <asset> [--restore-content] [--overwrite-owned]`, `repair --all` | Restore exact installed content and missing targets; modified content is quarantined, target overwrite remains limited to shared keys/blocks |
| `cleanup`, `recover`, `doctor [asset]` | Reclaim orphan content, recover a transaction, or inspect consistency |
| `list`, `search [text]`, `info <asset>`, `outdated` | Query committed state and candidate snapshots |
| `adapter add <directory> --capabilities link-directory,link-file` | Authorize and load an already installed plugin |
| `adapter remove <name>`, `adapter list` | Manage adapters; active placements prevent removal |
| `apply-plan <id>` | Apply a host-saved plan without replanning |

All commands support `--home` and `--json`. Changes support `--dry-run`; recover, apply-plan, apply-maintenance and recover-maintenance do not. maintenance requires --dry-run. Placement options are `--target` (default `openai-codex`), `--scope user|project` (default user), `--project`, and `--root`. Ambiguous existing placements require explicit selection. Unknown/repeated options are errors. Old aliases such as `uninstall`, `relink`, and `bundle install` are removed.

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

## Repairing all assets and source tracking

`repair --all` repairs all active assets in one transaction, deduplicating content by digest. It cannot select an asset or placement; modified content still requires `--restore-content`.

`tap update [name] --default-branch` clears a fixed ref and follows remote HEAD; it is mutually exclusive with `--ref`. Fixed refs are stored as full branch/tag names. Non-fast-forward switches still require `--allow-rewind`. Policy and snapshot commit together; previews do not change policy.

See [maintenance](maintenance.en.md) for its commands and global cancellation, deadline, and progress options.
