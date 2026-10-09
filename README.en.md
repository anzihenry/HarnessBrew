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

```sh
harnessbrew tap add team/assets https://example.com/team/assets.git
harnessbrew tap trust team/assets
harnessbrew search review
harnessbrew install team/assets/review --scope project --project .
harnessbrew doctor
```

The URL is a placeholder; replace it with a repository using the source format. Sources require explicit authorization. Removing an asset releases the manual reference; content needed by another Bundle remains.

## Documentation

- [Documentation map](docs/README.en.md)
- [Usage and commands](docs/guides/using.en.md), [SDK and plugins](docs/guides/sdk.en.md)
- [Upgrades](docs/guides/adapter-upgrades.en.md), [recovery](docs/guides/recovery.en.md), [maintenance](docs/guides/maintenance.en.md)
- [Development](docs/guides/development.en.md), [architecture](docs/engineering/architecture.en.md)
- [Documentation standard](docs/documentation.en.md), [changelog](CHANGELOG.en.md)

## License

[MIT](LICENSE).
