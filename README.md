---
title: HarnessBrew
status: current
owner: project-maintainers
updated: 2026-10-09
---

# HarnessBrew

[English](README.en.md)

HarnessBrew 是基于 Git 的 AI Agent 资产管理器：解析依赖、预览变更，并向 OpenAI Codex 投递 Skill、Agent、Workflow、Prompt、Instruction 和 MCP 配置。

当前源码版本为 **1.3.0**；仓库记录的是候选验收，正式发布状态见[版本记录](docs/releases/README.md)。Home、来源、资产、Bundle 和插件使用显式版本化格式；旧实验数据不自动迁移。

## 从源码运行

需要 Node.js 22+ 和 Git。

```sh
npm ci
npm run build
node dist/bin.js help
```

以下用 `harnessbrew` 表示构建后的命令，可通过 `--home /绝对路径` 或 `HARNESSBREW_HOME` 选择 Home，默认为 `~/.harnessbrew`。

## 快速开始

```sh
harnessbrew tap add team/assets https://example.com/team/assets.git
harnessbrew tap trust team/assets
harnessbrew search review
harnessbrew install team/assets/review --scope project --project .
harnessbrew doctor
```

URL 是占位示例，请替换为符合来源格式的仓库。来源必须显式授权；移除资产只释放当前手动引用，其他 Bundle 仍需要的内容会保留。

## 文档

- [文档地图](docs/README.md)
- [使用与命令](docs/guides/using.md)、[SDK 与插件](docs/guides/sdk.md)
- [升级](docs/guides/adapter-upgrades.md)、[恢复](docs/guides/recovery.md)、[维护](docs/guides/maintenance.md)
- [开发验证](docs/guides/development.md)、[项目架构](docs/engineering/architecture.md)
- [文档规范](docs/documentation.md)、[变更记录](CHANGELOG.md)

## 许可证

[MIT](LICENSE)。
