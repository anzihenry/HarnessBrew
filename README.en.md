---
title: HarnessBrew
status: current
owner: project-maintainers
updated: 2026-10-09
---

# HarnessBrew

[中文主版本](README.md)

HarnessBrew is a Git-native package manager for AI Agent assets. It resolves dependencies, previews changes, and delivers Skills, Agents, Workflows, Prompts, Instructions, and MCP configuration to OpenAI Codex.

The current source version is **1.3.0**. Repository records describe candidate acceptance; see [release records](docs/releases/README.en.md) for publication status. Homes, sources, assets, Bundles, and plugins use explicit versioned formats; old experimental data is not automatically migrated.

## Run from source

Requires Node.js 22+ and Git.

```sh
npm ci
npm run build
node dist/bin.js help
```

Examples use `harnessbrew` for the built command. Choose a Home with `--home /absolute/path` or `HARNESSBREW_HOME`; the default is `~/.harnessbrew`.

## Quick start

After building, run these commands from the repository root. The example creates a local Git Tap with an isolated Home and target in a temporary directory.

```sh
HB_DEMO="$(node scripts/examples/local-tap.mjs)"
node dist/bin.js --home "$HB_DEMO/home" tap add demo/assets "$HB_DEMO/tap"
node dist/bin.js --home "$HB_DEMO/home" search main-skill
node dist/bin.js --home "$HB_DEMO/home" tap trust demo/assets
node dist/bin.js --home "$HB_DEMO/home" install demo/assets/main-skill --root "$HB_DEMO/codex" --dry-run
node dist/bin.js --home "$HB_DEMO/home" install demo/assets/main-skill --root "$HB_DEMO/codex"
node dist/bin.js --home "$HB_DEMO/home" list
cat "$HB_DEMO/codex/skills/main-skill/SKILL.md"
node dist/bin.js --home "$HB_DEMO/home" doctor
node dist/bin.js --home "$HB_DEMO/home" remove demo/assets/main-skill
test ! -e "$HB_DEMO/codex/skills/main-skill"
```

Preview shows the planned target paths. Installation includes the helper-skill dependency. After removal, the final command verifies that the main Skill target is gone. Example data remains in `$HB_DEMO` for inspection.

## Documentation

- [Documentation map](docs/README.en.md)
- [Usage and commands](docs/guides/using.en.md), [SDK and plugins](docs/guides/sdk.en.md)
- [Upgrades](docs/guides/adapter-upgrades.en.md), [recovery](docs/guides/recovery.en.md), [maintenance](docs/guides/maintenance.en.md)
- [Development](docs/guides/development.en.md), [architecture](docs/engineering/architecture.en.md)
- [Documentation standard](docs/documentation.en.md), [changelog](CHANGELOG.en.md)

## License

[MIT](LICENSE).
