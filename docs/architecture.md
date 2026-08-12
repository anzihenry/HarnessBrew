# HarnessBrew Architecture

English | [简体中文](architecture.zh-CN.md)

> This document describes the target architecture of HarnessBrew. The implementation is migrating from the workspace/asset model toward the Tap/Formula/install model defined here.

## 1. Product position

HarnessBrew is a Git package manager for AI agent assets. It is analogous to Homebrew, not an asset-hosting service or centralized registry.

It discovers, installs, composes, upgrades, and removes AI agent assets whose contents are maintained in independent Git repositories. Assets include, but are not limited to:

- Skills
- Agents
- Workflows
- Instructions and rules
- Prompts
- MCP server configuration
- Adapters and other Agent extensions

HarnessBrew does not own user assets. Personal and third-party assets use the same Git source mechanism and differ only in repository ownership, write access, and trust level.

## 2. Design principles

1. **Git is the single source of version truth.** Commits, tags, and branches provide history, versions, and rollback; assets do not duplicate snapshots internally.
2. **All asset sources are equal.** Personal, team, and third-party assets all originate from Git Taps.
3. **Declaration is separate from installation.** A Formula describes an asset, the Cellar stores installed instances, and an Adapter delivers them to an Agent Target.
4. **Installation must be reversible.** Every installation creates a Receipt. Uninstallation removes only files owned by HarnessBrew and detects conflicts.
5. **Results must be reproducible.** A manifest declares desired state, while a lockfile pins exact Git commits and resolved dependency versions.
6. **Target platforms are decoupled.** One asset can be installed into Codex, Claude Code, Cursor, and other environments through Adapters.
7. **Untrusted code is not executed by default.** Third-party Formulae and assets begin as data. Executable code requires an explicit declaration and authorization.

## 3. Mapping to Homebrew

| Homebrew | HarnessBrew | Meaning |
| --- | --- | --- |
| `brew` | `harnessbrew` | Package-manager CLI |
| Tap | Tap | Git asset-source repository |
| Formula / Cask | Formula | Recipe for an installable Agent asset |
| Cellar | Cellar | Local installation area isolated by source and version |
| Link | Target link | Files or configuration delivered into an Agent environment |
| `Brewfile` | `Harnessfile` | Git-committable desired asset manifest |
| installed receipt | Receipt | Installation result, ownership, and source record |

## 4. System topology

```text
Personal Git Tap ─────┐
Team Git Tap ─────────┼──> Tap Resolver ──> Formula + Dependency Graph
Third-party Git Tap ──┘                              │
                                                    v
Harnessfile + Lockfile ─────────────────────────> Cellar
                                                    │
                                      Target Adapter / Linker
                                                    │
                          ┌─────────────────────────┼─────────────────────┐
                          v                         v                     v
                       Codex                  Claude Code              Cursor
```

The control plane consists of Taps, Formulae, the `Harnessfile`, and its lockfile. The data plane consists of immutable content in the Cellar and its links or rendered output in Agent Targets.

## 5. Core domain model

### 5.1 Tap

A Tap is an independently cloneable and updatable Git repository. It is the basic boundary for asset publication, collaboration, and version governance.

Prefer a repository per asset collection instead of one repository per Skill or Workflow:

```text
my-agent-tap/
├── tap.json
├── skills/
│   └── code-review/
│       ├── formula.json
│       └── SKILL.md
├── workflows/
│   └── release/
│       ├── formula.json
│       └── workflow.md
├── agents/
└── instructions/
```

A Tap identifier uses `<owner>/<name>`, for example:

- `your-name/agents` for personal assets
- `company/engineering-agents` for team assets
- `community/workflows` for third-party assets

`harnessbrew tap` registers Git sources only. HarnessBrew manages Tap clone, fetch, checkout, and caching. A newly registered Tap is untrusted by default: its Formulae may be browsed and installed into the Cellar, but cannot be activated in an Agent Target. Activation requires `tap trust`, `tap add --trust`, or `trust: true` in Harnessfile v2. Legacy state without a trust field is treated as trusted only for compatibility.

### 5.2 Formula

A Formula describes an installable asset without duplicating history already provided by Git. Minimal example:

```json
{
  "schemaVersion": 1,
  "name": "code-review",
  "kind": "skill",
  "description": "Review code changes with a consistent rubric.",
  "entry": "SKILL.md",
  "targets": ["openai-codex", "claude-code"],
  "dependencies": [
    "your-name/agents/repository-guardrails"
  ]
}
```

The full asset coordinate is `<tap>/<formula>`, such as `your-name/agents/code-review`. The CLI may accept `code-review` when the short name resolves uniquely; ambiguity requires a full coordinate.

A Formula may declare:

- Asset kind and entry file
- Supported Targets
- Asset dependencies
- Installation or rendering parameters
- Conflicts and deprecation information
- Integrity information
- Explicit installation hooks when necessary

A Formula should not maintain `.snapshots`, `history`, or manually copied content versions. Those belong to the containing Tap's commits and tags.

### 5.3 Cellar and Receipt

The Cellar stores resolved installation instances, isolated by source and version:

```text
~/.harnessbrew/
├── taps/
│   └── your-name/agents/        # Managed Git worktree or cache
├── cellar/
│   └── your-name/agents/code-review/<commit>/
├── receipts/
│   └── your-name/agents/code-review.json
└── state.json
```

A Receipt records at least:

- Full asset coordinate
- Tap URL, ref, and resolved commit SHA
- Dependency closure
- Installation Targets
- Cellar path
- Files created, linked, or rendered
- File digests and installation time

Receipt schema v2 represents Target side effects as operations. Each operation contains a stable ID, operation type, Target, destination path, optional source path, post-installation digest, managed configuration keys or block markers, and any parent directories created by the operation. V2 supports directory and file symlinks, rendered files, configuration merges, and managed blocks. Schema v1 `links` are normalized into file-symlink operations when read so existing installations remain verifiable, upgradeable, and removable.

The Receipt is the authority for safe uninstallation and conflict detection. HarnessBrew must not remove files it does not own through a Receipt. When installed files have been modified, HarnessBrew reports the difference before the user chooses whether to overwrite, preserve, or force removal.

### 5.4 Harnessfile and lockfile

The `Harnessfile` declares the top-level assets a user wants installed and can be committed to a dotfiles or project repository:

```yaml
schemaVersion: 2
taps:
  - name: your-name/agents
    git: git@github.com:your-name/agent-assets.git
    trust: true

assets:
  - formula: your-name/agents/code-review
    targets:
      - target: openai-codex
        scope: user
      - target: claude-code
        scope: project
        project: .
```

Harnessfile v2 uses structured Target placements. Relative `project` and `root` paths resolve from the Harnessfile directory. Tap `trust` is also declarative and defaults to `false`. Dependencies inherit placements from top-level assets. `bundle install` adds missing placements and removes managed placements no longer declared. Schema v1 string Target arrays remain supported as user-scope placements.

The generated lockfile is committed to Git and records:

- The exact commit SHA for every Tap
- The source and content digest of every Formula
- The complete dependency closure
- Adapter versions used during resolution

Lockfile v2 also stores the normalized Harnessfile digest, content digest of every Formula installation manifest, top-level request markers, and portable placements. Harnessfile or Adapter-version changes never rewrite the lock implicitly; `bundle install --update-lock` is required.

`harnessbrew bundle install` reconstructs the same environment from the lockfile. Only explicit update or upgrade operations change locked results.

### 5.5 Target and Adapter

A Target is a concrete Agent environment such as `openai-codex`, `claude-code`, or `cursor`. An Adapter:

- Validates compatibility between an asset and a Target
- Maps a common Formula to Target directories and formats
- Renders Target-specific configuration
- Produces the installation file plan
- Cooperates with the linker to create links or managed copies
- Verifies ownership and digests before removal

An Adapter handles platform differences only. It does not manage Git versions or solve dependencies.

#### Target capability matrix

A Target Adapter declares a deterministic installation strategy for every Formula kind. Target paths must not be guessed from `${kind}s`; unsupported combinations must be explicit.

| Formula | OpenAI Codex | Claude Code |
| --- | --- | --- |
| `skill` | `symlink-directory` | `symlink-directory` |
| `workflow` | `render-skill` | `render-skill` |
| `agent` | `render-file` | `render-file` |
| `instruction` | `managed-block` | `symlink-file` |
| `prompt` | `render-skill` | `render-skill` |
| `mcp` | `merge-config` | `merge-config` |
| `adapter` | `unsupported` | `unsupported` |

Strategy meanings:

- `symlink-directory`: link the complete asset directory, preserving relative scripts, references, and templates.
- `symlink-file`: link one Target-native file.
- `render-file`: have the Adapter generate a Target-native format.
- `render-skill`: project a common Workflow or Prompt as a Target Skill.
- `managed-block`: maintain an owned block inside shared configuration.
- `merge-config`: merge by configuration key and record key-level ownership in the Receipt.
- `unsupported`: reject Target delivery while allowing the asset to remain in the Cellar.

A Skill uses the standard directory layout with `SKILL.md` as its entry. User-scoped Codex Skills go to `~/.agents/skills/<name>` and Claude Code Skills to `~/.claude/skills/<name>`. Both link the complete Cellar directory so resources under `scripts/`, `references/`, and `assets/` remain available.

An Agent Formula uses common Markdown as portable source. The Adapter reads its name, description, and body and renders deterministic native output: `~/.codex/agents/<name>.toml` for Codex or `~/.claude/agents/<name>.md` for Claude Code. The Receipt records rendered-file digests and ownership. Repeated links verify the digest; upgrades regenerate from new source; user modifications block overwrite or removal by default.

An Instruction Formula also uses a Markdown entry. The Codex Adapter writes an owned block, named by Formula coordinate, into `~/.codex/AGENTS.md`. The Claude Code Adapter links the entry to `~/.claude/rules/<name>.md`. Because block markers and content digests are recorded, unlink, uninstall, and upgrade touch only HarnessBrew-owned content and stop if it has been modified.

Workflow and Prompt Formulae use `render-skill` to project into `<target-skill-root>/<name>/SKILL.md`. Generated files contain standard `name` and `description` frontmatter plus HarnessBrew metadata for the original Formula kind and coordinate. The body remains the Formula's Markdown entry. Codex and Claude Code use the same portable model instead of platform-specific command directories.

An MCP Formula uses common JSON for stdio or HTTP transport. Credential fields reference environment-variable names only: stdio uses `envVars`, while HTTP uses `bearerTokenEnvVar` and `headersFromEnv`. Formulae cannot store plaintext secrets. Codex receives coordinate-marked `[mcp_servers.<name>]` blocks in `config.toml`; Claude Code receives a merged `mcpServers.<name>` key in `.claude.json` or project `.mcp.json`. The Receipt tracks block or key ownership and value digests. Conflicting keys, modified owned values, or invalid configuration abort the operation. Uninstallation removes only the corresponding block or key.

An Adapter Formula is currently stored only as a Git/Cellar asset and cannot be delivered to a built-in Target. The capability matrix must return `unsupported`; no generic directory fallback is permitted. Third-party Targets participate through a versioned Adapter SDK explicitly registered by the host. HarnessBrew never executes Adapter Formulae from a Tap automatically.

#### Target scope and instance identity

Target Context distinguishes `user` and `project` scopes. Project scope requires a normalized project root. An explicit `target-root` has higher priority as an isolation override. Project-scoped Codex paths are `.agents/skills`, `.codex/agents`, root `AGENTS.md`, and `.codex/config.toml`. Claude Code uses `.claude/skills`, `.claude/agents`, `.claude/rules`, and root `.mcp.json`.

A Target instance is identified by `target + destination`, not by Target name alone. Each Receipt operation stores scope, explicit root, and project root. One Formula can therefore be delivered to user and project scope at the same time. Upgrade rebuilds each instance and unlink removes only the selected instance. For compatibility, an omitted scope may select the only existing instance; multiple instances make the request ambiguous and must be rejected.

#### Doctor and relink

`doctor` validates the Cellar inventory and every Target operation for each Receipt. A Cellar digest mismatch reports `cellar-modified`, a missing destination reports `target-missing`, and a mismatched ownership marker, symlink destination, or render digest reports `target-modified`. Diagnosis is read-only and can be limited to one Formula.

`relink` is an explicit repair operation. It first requires an intact Cellar inventory, removes damaged HarnessBrew operations using scope and root stored in the Receipt, and runs the Adapter plan again. Shared configuration remains limited to owned blocks or keys. Callers may select a Target and scope; an insufficient selector for multiple instances is rejected.

## 6. Main lifecycles

### 6.1 Registering an asset source

```bash
harnessbrew tap your-name/agents git@github.com:your-name/agent-assets.git
harnessbrew tap community/workflows https://github.com/community/agent-workflows.git
```

The flow registers a URL, clones or fetches the Tap, validates `tap.json` and Formulae, builds a local index, and records explicit trust. Registration does not grant Target activation by default.

### 6.2 Installation

```bash
harnessbrew install your-name/agents/code-review --target openai-codex
```

1. Resolve the name, ref, and Git commit.
2. Read the Formula and solve its dependency closure.
3. Validate Target compatibility, trust policy, and file conflicts.
4. Place immutable content in the Cellar.
5. Ask the Adapter for an installation plan.
6. Link or render into the Agent Target.
7. Write the Receipt and lock state.

Failure at any step rolls back files created by that installation.

### 6.3 Update and upgrade

```bash
harnessbrew update
harnessbrew outdated
harnessbrew upgrade code-review
```

- `update` fetches the latest Git state and index for Taps without changing installed assets. It accepts fast-forwards only by default; rewritten history requires `--allow-rewind`. Failed checkout or Formula validation restores every processed Tap checkout and leaves state unchanged.
- `outdated` compares the installed commit, current constraints, and available versions.
- `upgrade` shows source and content differences, installs the new version, and updates links, the Receipt, and the lockfile.

### 6.4 Uninstallation

```bash
harnessbrew uninstall code-review
```

The flow reads the Receipt, checks reverse dependencies and local modifications, removes HarnessBrew-owned Target files, deletes unreferenced Cellar instances, and updates state. Removing an asset does not remove its Tap; only `untap` removes the source registration and local cache.

### 6.5 Environment reconstruction

```bash
harnessbrew bundle install
harnessbrew bundle cleanup
```

- `bundle install` converges the machine to the state declared by the `Harnessfile` and lockfile.
- `bundle cleanup` lists and optionally removes managed assets outside the manifest.

## 7. Layered architecture

### CLI layer

Parses commands and arguments and presents plans, differences, conflicts, and results without directly manipulating Agent Target files. Every command supports a schema v1 JSON envelope with stable fields: `ok`, `command`, `exitCode`, `dryRun`, command-specific `result`, compatible text `output`, and `diagnostics`; failures add structured `error` data.

### Tap and Git layer

Manages Tap registration, clone/fetch/checkout, ref resolution, commit pinning, local caching, and Git differences.

### Catalog layer

Discovers and validates Formulae and indexes name, kind, tag, Target, and deprecation state.

### Resolver layer

Resolves asset coordinates and dependency graphs, including missing dependencies, cycles, version constraints, conflicts, and Target compatibility.

### Cellar and state layer

Manages immutable installation instances, Receipts, lockfiles, reference counts, and garbage collection.

### Adapter layer

Converts the common asset model into Agent-specific directory structures and configuration formats and emits deterministic installation plans.

### Transaction layer

Creates, links, replaces, and removes files, handling conflict detection, digest validation, rollback, and safe uninstallation.

Every mutating CLI command runs under one HarnessBrew Home write lock and a durable transaction. Before a path is first modified, the transaction layer writes its original state to `<home>/transactions/<id>/journal.json`, saves the required file or directory snapshot, and synchronizes the journal before atomic replacement. Success removes the transaction directory. Ordinary errors restore operations in reverse order. After a process crash, the next mutating command reclaims the abandoned lock and restores every uncommitted journal.

`--dry-run` uses the same transaction instead of a second approximate planner. After completing real validation, the command compares original and resulting fingerprints for journaled paths to produce `changes`, then rolls everything back before releasing the Home write lock. Resolution, conflict, and safety checks therefore match real execution. Read-only external work such as Git fetch or clone can still occur.

Shared Target files outside Home record a post-write fingerprint. Recovery validates the journal, backup, and current fingerprint. If another transaction modified the path after a crash, HarnessBrew preserves current content and reports a recovery conflict instead of overwriting valid later work with an old snapshot.

## 8. Git and version strategy

HarnessBrew resolves versions in this order:

1. Commit SHA from the lockfile for reproducible installation.
2. A user-declared Git tag or commit.
3. A user-declared branch.
4. The Tap's default branch.

Semantic tags may be used for display, but internal installation identity always includes an immutable commit SHA. A branch name is an update channel, not a stable version.

Recommended publication flow for personal assets:

1. Edit the Formula and content in the personal Tap.
2. Record changes with ordinary Git commits.
3. Optionally create a semantic tag as a stable release point.
4. Run `update` and `upgrade` in consuming environments.
5. Review the difference and update the lockfile.

## 9. Security and ownership boundaries

- Tap content is untrusted input by default.
- Tap trust controls Target activation, not read-only discovery or Cellar installation. Revoking trust still permits cleanup operations such as unlink and uninstall.
- Updates require fast-forward continuity and restore checkout and state when candidate validation fails. `--allow-rewind` is an explicit escape hatch for manually reviewed history rewrites.
- Formulae use declarative data and do not load executable Tap code by default.
- The destination Targets and file list are shown before installation.
- Installation hooks must declare capabilities and receive separate authorization.
- Receipts store file digests to detect post-installation modification.
- Uninstallation may touch only paths explicitly recorded by the Cellar and Receipt.
- One path has one explicit owner; conflicts are resolved before writing.
- Credentials for private Taps remain with system Git/SSH credential management. HarnessBrew does not store secrets.

## 10. Plugin direction

Changes in Agent platforms should be decoupled from core package management. Adapters can eventually be distributed as plugins such as:

- `@harnessbrew/adapter-openai-codex`
- `@harnessbrew/adapter-claude-code`
- `@harnessbrew/adapter-cursor`

The plugin contract takes an installed Receipt and Target Context and returns a deterministic installation plan. Registration validates API and plugin versions and a complete Formula capability matrix. Every plan validates Target, coordinate, strategy, absolute destination, and that each source remains inside the Cellar. Capability snapshots are frozen after registration, and third-party Adapter name and version enter the Harnessfile v2 Adapter signature.

Adapter API v1 is deliberately narrow: third-party Adapters may declare one `symlink-file` or `symlink-directory` operation, or `unsupported`. The core transaction layer performs, records, diagnoses, and rolls back the operation. Rendering, managed blocks, and configuration merging remain built-in. The SDK exposes no write callback and never loads JavaScript from a Tap.

The standalone CLI manages installed, trusted npm modules through `adapter add/list/remove`; explicit absolute paths and `file://` URLs are also accepted. `adapter add` authorizes code execution: it imports the module, runs SDK validation, and records the module specifier plus reviewed name, version, and API version in `adapters.json`. Later commands load it only when a Target plan is needed and require the exported identity to match the snapshot exactly. Identity drift fails closed until the module is removed, reviewed, and added again. List and remove do not import modules, and the CLI never runs `npm install`. Because a plugin has Node.js host privileges, this trust list makes loading explicit and identity drift detectable but does not replace code review.

## 11. HarnessBrew boundaries

HarnessBrew is responsible for:

- Managing Git Taps
- Discovering and validating Formulae
- Resolving dependencies and compatibility
- Installing, upgrading, and safely uninstalling assets
- Managing the Cellar, Receipts, Harnessfile, and lockfile
- Adapting assets to different Agent platforms

HarnessBrew is not responsible for:

- Hosting user assets or acting as a Git service
- Replacing Git history, branches, tags, or collaboration
- Duplicating asset snapshot history inside Formulae
- Executing arbitrary scripts from third-party repositories by default
- Modifying or removing user files it does not own

In one sentence:

> HarnessBrew does not own assets; it uses Git to discover, install, compose, upgrade, and remove AI agent assets.
