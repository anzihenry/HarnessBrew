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

## Adapter upgrades

Inspect the candidate without importing its code. Inspection does not return an executable plan ID:

```sh
harnessbrew adapter inspect-upgrade openai-codex --module builtin:codex --json
```

Review the signature, versions, signature coverage and affected bindings, then explicitly authorize the digest and capabilities. For a third-party adapter, use its package directory instead of `builtin:codex`; only `link-directory` and `link-file` are allowed. Legacy declarations have no static capability field, so requiredCapabilities is null until authorized loading checks the actual export.

```sh
harnessbrew adapter upgrade openai-codex --module builtin:codex \
  --authorize-signature <signature-from-inspection> \
  --capability link-directory --capability link-file --capability write-file \
  --capability write-block --capability set-config \
  --bundle-file ./one/Harnessfile.yaml --bundle-file ./two/Harnessfile.yaml \
  --dry-run
harnessbrew apply-plan <plan-id>
```

Supply `--bundle-file` only for affected Bundles, once per checkout. Missing inputs return `LOCK_MISMATCH` with missingBindings. The SDK exposes `inspectAdapterUpgrade({name, module})` and `plan/execute({kind: "adapter.upgrade", name, module, authorizedSignature, capabilities, bundleFiles})`.

An upgrade pins installed asset commits, content and dependency closure, and replans only the selected adapter. Registration, targets and every affected Bundle lock commit in one transaction. It never implicitly upgrades assets or grants extra capabilities. Candidate drift returns `ADAPTER_CHANGED`; changed preview inputs reject commit. Shared edits preserve unrelated content. Operation-type changes on an existing resource, parent/child overlaps and unowned destinations can be rejected; there is no force bypass. Repeating an unchanged upgrade is idempotent.

Upgrade previews use saved-plan v3; ordinary previews remain v2. Home, Journal, Bundle lock and CLI result remain v1. Existing built-in registrations require explicit upgrade to adopt the new build-signature rule. Retain the old package and a consistent Home/targets/all-locks backup before upgrading. Third-party adapters can explicitly upgrade back to a retained old package. Downgrading the executable alone does not restore registration and targets; see [compatibility and rollback](docs/design/batch-b-compatibility.zh-CN.md).

## Preview, recovery, and JSON

Preview may populate isolated source/plan caches next to the Home, but does not initialize a new Home, grant trust, write a Bundle lock, or alter targets. Saved plans are local to that Home; changed revisions, targets, input manifests, or plugins cause rejection. No arbitrary operation JSON is accepted.

Git/source preparation, plugin preparation and content staging happen outside transaction write locks. Commit rechecks all prepared evidence. If concurrent changes invalidate a preview (`PLAN_STALE`), rerun the original command with `--dry-run` and apply the new plan ID; there is no automatic replan. Saved-plan v1 previews must be regenerated for v2. Home/Journal and public JSON formats remain v1. First-time preview leaves Home uninitialized; a competing initialization can invalidate it.

Process leases and durable preview references protect caches, including historical cache roots. Path aliases to the same physical Home share cache protection. Do not manually remove caches in use. Cache GC is not yet provided. Applying a plan can consume its staged content; regenerate the preview if staging is unavailable when retrying. See [architecture](docs/architecture.md) for execution and recovery boundaries.

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

## Cache maintenance and operation controls

Use `maintenance --dry-run --json` to save a reclamation preview, then `apply-maintenance <planId>` to apply exactly that preview. `recover-maintenance` resumes interrupted reclamation. This is separate from installed-content `cleanup`.

Default retention is 30 days, the newest 10 objects per category, and a 1 GiB reporting budget. Override it with `--ttl-days`, `--keep-newest`, and `--max-bytes`. CURRENT, recovery evidence, active leases, valid plan inputs, catalog/repair sources, and registered adapters take precedence over limits. Unknown objects and user quarantines are retained. Protected data may exceed the budget. Revisions are audit snapshots, not complete backups. Saved installation plans expire after 30 days; applying an expired plan returns `PLAN_STALE`, never an implicit replan.

SDK methods accept a separate final options argument:

```ts
const controller = new AbortController();
try {
  const preview = await harness.plan(request, {
    signal: controller.signal,
    timeoutMs: 30_000,
    onProgress: event => console.error(event.phase, event.completed),
  });
  const result = await harness.apply(preview.planId);
  console.log(result.outcome, result.maintenance, result.effects);
} finally {
  await harness.close();
}
```

`effects` is a discriminated union (`asset`, `metadata`, `adapter-upgrade`); legacy `changes` remains available. `outcome` distinguishes `committed` and `unchanged`; `maintenance: "recovery-required"` means a committed result needs cleanup, not a retry of the original mutation. Error recovery instructions identify `recover` or `recover-maintenance`.

Timeout starts at invocation. Pre-commit cancellation rolls back safely; recovery and rollback can exceed the deadline. Once committed, cancellation still returns the committed result. Synchronous work and plugin calls respond at the next safe checkpoint. Maintenance finishes its recoverable deletion once its intent is durable. `close()` rejects new work and waits for accepted operations and leases; it does not cancel them and is idempotent. Progress callback errors do not affect outcomes.

CLI `--progress` writes phase/count events to stderr; `--json` stdout remains one document. `--timeout-ms` sets the command deadline. SIGINT/SIGTERM request safe cancellation. Cancellation exits 130; timeout exits 124. Progress contains no paths, payloads, or credentials.
