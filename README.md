# HarnessBrew

English | [简体中文](README.zh-CN.md)

HarnessBrew is a Git package manager for AI agent assets. Like Homebrew, it discovers assets through Git Taps, describes them with Formulae, and uses a Cellar and Receipts to install, upgrade, and safely uninstall them.

HarnessBrew does not host assets. Personal, team, and third-party assets remain in their own Git repositories and use the same installation mechanism.

## Features

- Register, update, and remove Git Taps
- Validate and search skill, agent, workflow, instruction, prompt, MCP, and adapter Formulae
- Resolve dependencies, cycles, missing entries, and conflicts
- Install immutable content into the Cellar at a specific Git commit
- Link assets into OpenAI Codex and Claude Code
- Deliver Skills, Agents, Workflows, Prompts, Instructions, and MCP configuration in native formats
- Support user and project scopes, including multiple instances of one Target
- Track file, configuration-key, managed-block, and SHA-256 ownership in Receipts
- Diagnose Target drift with `doctor` and repair it with `relink`
- Detect upgrades while preserving Agent Target links
- Reproduce environments across machines with a `Harnessfile` and lockfile
- Install from npm and publish through GitHub Releases

## Installation

Requirements: Node.js 20 or later and Git available on the system.

```bash
npm install --global harnessbrew
harnessbrew --version
```

You can also run it directly:

```bash
npx harnessbrew help
```

HarnessBrew stores managed state in `~/.harnessbrew` by default. Set `HARNESSBREW_HOME` for tests or isolated environments.

## Quick start

Register an asset Tap:

```bash
harnessbrew tap add xiejinheng/agents git@github.com:xiejinheng/agent-assets.git --trust
```

Search for and inspect Formulae:

```bash
harnessbrew search review
harnessbrew search --kind skill --target openai-codex
harnessbrew info xiejinheng/agents/code-review
```

Install into the Cellar and link into Codex:

```bash
harnessbrew install xiejinheng/agents/code-review \
  --target openai-codex
```

Omit `--target` to keep the asset in the Cellar without modifying an Agent configuration directory.

Update and upgrade:

```bash
harnessbrew update [--allow-rewind]
harnessbrew outdated
harnessbrew upgrade code-review
```

Safely uninstall:

```bash
harnessbrew uninstall code-review
```

HarnessBrew stops if a managed file or link has changed. Pass `--force` explicitly when the modified target should still be removed.

## Homebrew concepts

| Homebrew | HarnessBrew |
| --- | --- |
| `brew` | `harnessbrew` |
| Tap | Git asset-source repository |
| Formula / Cask | Agent asset Formula |
| Cellar | Commit-isolated local installation area |
| Link | Link into Codex, Claude Code, or another Target |
| `Brewfile` | `Harnessfile` |
| Receipt | Installation source, digest, and ownership record |

## Creating a Tap

A Tap is a regular Git repository. Prefer one repository per asset collection instead of one repository per Skill.

```text
my-agent-tap/
├── tap.json
├── skills/
│   └── code-review/
│       ├── formula.json
│       └── SKILL.md
├── workflows/
├── agents/
├── instructions/
├── prompts/
├── mcp/
└── adapters/
```

Minimal `tap.json`:

```json
{
  "schemaVersion": 1
}
```

The Formula directory name must match `name`, and its parent directory must match `kind`:

```json
{
  "schemaVersion": 1,
  "name": "code-review",
  "kind": "skill",
  "description": "Review code changes with a consistent rubric.",
  "entry": "SKILL.md",
  "targets": ["openai-codex", "claude-code"],
  "dependencies": [
    "xiejinheng/agents/repository-guardrails"
  ],
  "conflicts": [],
  "tags": ["review", "quality"]
}
```

The full coordinate is `<owner>/<tap>/<formula>`. Dependencies and conflicts must use full coordinates to avoid ambiguity across Taps.

The Git commit is the single source of truth for an installed version. Formulae do not maintain duplicate `.snapshots` or `history` data.

An MCP Formula uses a common JSON entry format. Stdio configuration uses `command`, optional `args`, and `envVars` containing environment-variable names only. HTTP configuration uses `transport: "http"`, `url`, optional `bearerTokenEnvVar`, and `headersFromEnv`. HarnessBrew rejects plaintext `env` secret values in entries.

An `adapter` Formula is a Git/Cellar-managed extension asset, but it is never executed automatically. Target Adapter runtime modules use a separate trust mechanism: review and install an npm package, then authorize it explicitly with `harnessbrew adapter add <module>`. Taps therefore remain declarative while third-party Targets can use the versioned Adapter SDK.

## Targets

Built-in Targets:

- `openai-codex`
- `claude-code`

Select a Target during installation:

```bash
harnessbrew install code-review --target openai-codex
```

Codex Skills are installed in `~/.agents/skills` by default, while other Codex configuration uses `~/.codex`; Claude Code uses `~/.claude`. Skills are linked as complete directories, preserving relative resources such as `scripts/`, `references/`, and `assets/` alongside `SKILL.md`.

Workflows and Prompts are projected as Target Skills with standard frontmatter. Agents use portable Markdown source and are rendered deterministically to `.codex/agents/<name>.toml` for Codex or `.claude/agents/<name>.md` for Claude Code. Instructions use owned managed blocks in Codex `AGENTS.md` and links under `.claude/rules/<name>.md` in Claude Code. MCP configuration is merged as TOML blocks or JSON keys. Removing shared configuration never overwrites user-owned content.

Use an isolated Target root when needed:

```bash
harnessbrew install code-review \
  --target openai-codex \
  --target-root /path/to/sandbox/.codex
```

Targets support user and project scopes. `--project` implicitly selects project scope. The same Formula can exist in both scopes, and its Receipt records operations by their actual destination:

```bash
harnessbrew link code-review --target openai-codex --scope user
harnessbrew link code-review --target openai-codex --scope project --project /path/to/repo
harnessbrew unlink code-review --target openai-codex --scope project --project /path/to/repo
```

Project-scoped Codex assets use `.agents/skills`, `.codex/agents`, the root `AGENTS.md`, and `.codex/config.toml`. Claude Code uses `.claude/skills`, `.claude/agents`, `.claude/rules`, and the root `.mcp.json`. When a Target has multiple instances, `unlink` requires an explicit scope.

`harnessbrew doctor [formula]` validates Cellar file digests and every Target operation, distinguishing missing targets from modified ones. If the Cellar is intact, `harnessbrew relink <formula>` forcibly reconstructs HarnessBrew-owned targets using the scope and root recorded in the Receipt. Use `--target`, `--scope`, and `--project` to repair one instance.

Links can also be managed separately:

```bash
harnessbrew link code-review --target openai-codex
harnessbrew unlink code-review --target openai-codex
```

## Harnessfile

A `Harnessfile` can be committed to a dotfiles or project repository:

```yaml
schemaVersion: 2
taps:
  - name: xiejinheng/agents
    git: git@github.com:xiejinheng/agent-assets.git
    ref: main
    trust: true

assets:
  - formula: xiejinheng/agents/code-review
    targets:
      - target: openai-codex
        scope: user
      - target: claude-code
        scope: project
        project: .
```

Target placements in v2 declare `user` or `project` scope and may use `project` and `root` paths relative to the `Harnessfile`. Schema v1 `targets: [openai-codex]` remains compatible and is interpreted as user scope.

Install and generate `Harnessfile.lock`:

```bash
harnessbrew bundle install
```

The v2 lockfile records the manifest digest, HarnessBrew Adapter versions, exact commit for every Tap, Formula content digests, dependency closure, and full Target placements. Commit it together with the `Harnessfile`.

On another machine, the same command checks out commits pinned by the lockfile instead of silently using the latest Tap versions. After changing a v2 Harnessfile, update the lockfile explicitly:

```bash
harnessbrew bundle install --update-lock
```

Remove managed assets not present in the manifest:

```bash
harnessbrew bundle cleanup
```

Use a different manifest path:

```bash
harnessbrew bundle install --file ./config/Harnessfile
```

## CLI

```text
harnessbrew tap add <owner/name> <git-url> [--ref <ref>] [--trust]
harnessbrew tap list
harnessbrew tap update [owner/name] [--allow-rewind]
harnessbrew tap trust <owner/name>
harnessbrew tap untrust <owner/name>
harnessbrew tap remove <owner/name>
harnessbrew untap <owner/name>
harnessbrew search [query] [--kind <kind>] [--target <target>]
harnessbrew info <formula>
harnessbrew install <formula> [--target <target>] [--scope <user|project>] [--project <path>] [--target-root <path>]
harnessbrew list
harnessbrew link <formula> --target <target> [--scope <user|project>] [--project <path>] [--target-root <path>]
harnessbrew unlink <formula> --target <target> [--scope <user|project>] [--project <path>] [--force]
harnessbrew doctor [formula]
harnessbrew relink <formula> [--target <target>] [--scope <user|project>] [--project <path>]
harnessbrew update
harnessbrew outdated
harnessbrew upgrade [formula]
harnessbrew uninstall <formula> [--force]
harnessbrew bundle install [--file <path>] [--update-lock]
harnessbrew bundle cleanup [--file <path>]
```

Every command accepts `--json`. Standard output then contains one schema v1 JSON envelope: `result` is the command-specific structured result, `output` retains human-readable text, and failures include `error.code`, `error.message`, `diagnostics`, and a non-zero `exitCode`.

Mutating commands also accept `--dry-run`. Under the same Home write lock, HarnessBrew runs full validation and the installation transaction, collects before/after types and digests for each path, then rolls back the Cellar, Receipts, Tap checkouts, and Agent Targets. With `--json`, the preview appears in `changes`. A dry run can still perform read-only network operations such as Git fetch or clone.

```bash
harnessbrew install code-review --target openai-codex --dry-run --json
```

## Local directories

```text
~/.harnessbrew/
├── taps/       # Git worktrees managed by HarnessBrew
├── cellar/     # Immutable content isolated by Formula and commit
├── receipts/   # Installation, dependency, Target-link, and digest records
└── state.json  # Tap registration state
```

HarnessBrew owns the Tap worktrees and Cellar contents; do not edit them directly. Change personal assets in the source Tap repository, commit and push, then install the changes with `update` and `upgrade`.

## Security boundaries

- Formulae are declarative JSON; HarnessBrew does not execute arbitrary Tap scripts.
- Newly registered Taps are untrusted by default. They can be searched and installed into the Cellar, but linking or rendering into an Agent Target requires `tap trust`, `tap add --trust`, or `trust: true` in Harnessfile v2. Legacy state records are treated as trusted for compatibility.
- Tap updates accept Git fast-forwards only by default. Rewritten history must be reviewed and accepted with `--allow-rewind`. A failed candidate-commit validation restores the original checkout and state.
- Formula entries cannot escape their containing directories.
- Dependencies, conflicts, and Target compatibility are checked before installation.
- HarnessBrew does not overwrite target files it does not own through a Receipt.
- Uninstallation validates Cellar digests and symlink destinations first.
- Credentials for private Taps are handled by the system Git/SSH credential mechanism.

## Development

The project uses TypeScript 7.0 with strict type checking.

```bash
npm ci
npm run build
npm test
npm run check
```

`npm run check` runs TypeScript compilation, all Node.js tests, a package smoke test, and `npm pack --dry-run`.

## Target Adapter SDK

Node.js and TypeScript hosts can register third-party Agent Targets through the public API. Adapter API v1 receives only a Receipt and Target Context and returns a declarative installation plan. Writes, conflict detection, Receipts, `doctor`, `relink`, upgrades, dry runs, and rollback remain the responsibility of the HarnessBrew transaction layer.

```ts
import { registerTargetAdapter, type TargetAdapter } from "harnessbrew";

const adapter: TargetAdapter = {
  apiVersion: 1,
  name: "cursor",
  version: "1.0.0",
  capabilities: {
    skill: "symlink-directory",
    agent: "symlink-file",
    workflow: "symlink-file",
    instruction: "symlink-file",
    prompt: "symlink-file",
    mcp: "unsupported",
    adapter: "unsupported"
  },
  plan(receipt, context = {}) {
    // Return one absolute destination and a source inside receipt.cellarPath.
    return { target: "cursor", coordinate: receipt.coordinate, operations: [/* ... */] };
  }
};

const unregister = registerTargetAdapter(adapter);
```

The SDK validates API version, name, version, the complete capability matrix, plan identity, absolute target paths, and Cellar source boundaries. Third-party Adapter plans in v1 may use only `symlink-file`, `symlink-directory`, and `unsupported`; they cannot write files directly or generate shared configuration. Registration is explicit and process-local. HarnessBrew never executes Adapter Formulae from a Tap automatically. A third-party Adapter has the host process's privileges and should be loaded only from a reviewed npm package.

The standalone CLI can persist trusted Adapter modules. The module must already be installed and resolvable by `harnessbrew`, or be supplied as an absolute path or `file://` URL. It must default-export an Adapter or provide a named `adapter` export:

```bash
harnessbrew adapter add @harnessbrew/adapter-cursor
harnessbrew adapter list
harnessbrew install review --target cursor
harnessbrew adapter remove cursor
```

`adapter add` explicitly authorizes code execution. HarnessBrew records the module specifier and reviewed name, version, and API version in `~/.harnessbrew/adapters.json`. It loads the module only when install, link, unlink, relink, upgrade, or bundle operations need that Target, and verifies its identity every time. If a package upgrade changes identity, the command fails closed until the module is removed, reviewed, and added again. `adapter list` and `adapter remove` do not execute plugins, and HarnessBrew never runs `npm install` automatically. CLI-loaded Targets are also included in the Harnessfile v2 Adapter signature.

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full design.

## License

MIT
