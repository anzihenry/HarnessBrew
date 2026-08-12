# HarnessBrew

[English](README.md) | 简体中文

[![CI](https://github.com/anzihenry/HarnessBrew/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/anzihenry/HarnessBrew/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/harnessbrew.svg?logo=npm)](https://www.npmjs.com/package/harnessbrew)
[![Node.js](https://img.shields.io/node/v/harnessbrew.svg?logo=nodedotjs)](https://www.npmjs.com/package/harnessbrew)
[![License](https://img.shields.io/github/license/anzihenry/HarnessBrew.svg)](https://github.com/anzihenry/HarnessBrew/blob/main/LICENSE)

HarnessBrew 是面向 AI Agent 资产的 Git 包管理器。它的定位类似 Homebrew：通过 Git Tap 发现资产，通过 Formula 描述资产，通过 Cellar 与 Receipt 安装、升级和安全卸载资产。

HarnessBrew 不托管资产。个人、团队和第三方资产都保存在各自的 Git 仓库中，并使用完全相同的安装机制。

## 主要能力

- 注册、更新和移除 Git Tap
- 校验并搜索 skill、agent、workflow、instruction、prompt、MCP 和 adapter Formula
- 解析依赖、循环、缺失项与冲突
- 按 Git commit 将不可变内容安装到 Cellar
- 链接到 OpenAI Codex 和 Claude Code
- 以原生格式投递 Skill、Agent、Workflow、Prompt、Instruction 和 MCP
- 支持 user/project scope，以及同一 Target 的多实例
- 通过 Receipt 跟踪文件、配置键、受管区块所有权和 SHA-256 摘要
- 使用 `doctor` 诊断并通过 `relink` 修复 Target 漂移
- 检测可用升级，并在升级后保留 Agent target 链接
- 使用 `Harnessfile` 和 lockfile 在不同设备上复现环境
- 从 npm 安装并通过 GitHub Release 发布

## 安装

要求：Node.js 22 或更高版本，系统中可用 Git。

```bash
npm install --global harnessbrew
harnessbrew --version
```

也可以直接使用：

```bash
npx harnessbrew help
```

HarnessBrew 默认将受管状态保存到 `~/.harnessbrew`。测试或隔离环境可以设置 `HARNESSBREW_HOME`。

## 快速开始

注册自己的资产 Tap：

```bash
harnessbrew tap add your-name/agents git@github.com:your-name/agent-assets.git --trust
```

搜索并查看 Formula：

```bash
harnessbrew search review
harnessbrew search --kind skill --target openai-codex
harnessbrew info your-name/agents/code-review
```

安装到 Cellar，并链接到 Codex：

```bash
harnessbrew install your-name/agents/code-review \
  --target openai-codex
```

如果只希望保存到 Cellar，不写入 Agent 配置目录，可以省略 `--target`。

更新和升级：

```bash
harnessbrew update [--allow-rewind]
harnessbrew outdated
harnessbrew upgrade code-review
```

安全卸载：

```bash
harnessbrew uninstall code-review
```

若受管文件或链接已被修改，HarnessBrew 会停止卸载。确认需要删除时可以显式传入 `--force`。

## Homebrew 概念对应

| Homebrew | HarnessBrew |
| --- | --- |
| `brew` | `harnessbrew` |
| Tap | Git 资产源仓库 |
| Formula / Cask | Agent 资产 Formula |
| Cellar | 按 Git commit 隔离的本地安装区 |
| Link | 到 Codex、Claude Code 等 target 的链接 |
| `Brewfile` | `Harnessfile` |
| Receipt | 安装来源、文件摘要与所有权记录 |

## 创建 Tap

Tap 是普通 Git 仓库。推荐按资产集合建立 Tap，不需要为每个 skill 单独建立仓库。

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

最小 `tap.json`：

```json
{
  "schemaVersion": 1
}
```

Formula 的目录名称必须与 `name` 一致，目录类型必须与 `kind` 一致：

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
  ],
  "conflicts": [],
  "tags": ["review", "quality"]
}
```

完整坐标为 `<owner>/<tap>/<formula>`。依赖和冲突必须使用完整坐标，以避免跨 Tap 名称歧义。

Git commit 是安装版本的唯一事实来源；Formula 不维护 `.snapshots` 或重复的 `history`。

MCP Formula 的入口是统一 JSON。stdio 配置使用 `command`、可选 `args` 和只包含环境变量名称的 `envVars`；HTTP 配置使用 `transport: "http"`、`url`、可选 `bearerTokenEnvVar` 与 `headersFromEnv`。HarnessBrew 不接受入口中的明文 `env` 密钥值。

`adapter` Formula 是可由 Git/Cellar 管理的扩展资产，但不会作为代码自动执行。Target Adapter 运行时使用单独的可信模块机制：先审查并安装 npm 包，
再通过 `harnessbrew adapter add <module>` 显式授权。这样 Tap 仍保持声明式、不执行任意代码，而第三方 Target 可以接入版本化 Adapter SDK。

## Target

当前内置：

- `openai-codex`
- `claude-code`

可以在安装时指定 target：

```bash
harnessbrew install code-review --target openai-codex
```

Codex Skill 默认安装到 `~/.agents/skills`，其他 Codex 配置使用 `~/.codex`；Claude Code 使用 `~/.claude`。Skill 以完整目录软链安装，因此 `scripts/`、`references/` 和 `assets/` 等相对资源会与 `SKILL.md` 一起生效。Workflow 和 Prompt 会被投影为带标准 frontmatter 的 Target Skill。Agent 则以统一 Markdown 作为源码：投递到 Codex 时确定性渲染为 `.codex/agents/<name>.toml`，投递到 Claude Code 时渲染为 `.claude/agents/<name>.md`。Instruction 在 Codex 的 `AGENTS.md` 中使用带所有权标记的受管区块，在 Claude Code 中链接为 `.claude/rules/<name>.md`；MCP 分别按 TOML 区块或 JSON 键合并。卸载这些共享配置不会覆盖用户内容。需要隔离安装时可使用：

```bash
harnessbrew install code-review \
  --target openai-codex \
  --target-root /path/to/sandbox/.codex
```

Target 支持用户级与项目级 scope；`--project` 会隐式选择 project scope。同一 Formula 可以同时存在于两个 scope，Receipt 会按实际目标路径分别记录操作：

```bash
harnessbrew link code-review --target openai-codex --scope user
harnessbrew link code-review --target openai-codex --scope project --project /path/to/repo
harnessbrew unlink code-review --target openai-codex --scope project --project /path/to/repo
```

项目级 Codex 资产使用项目中的 `.agents/skills`、`.codex/agents`、根 `AGENTS.md` 和 `.codex/config.toml`；Claude Code 使用 `.claude/skills`、`.claude/agents`、`.claude/rules` 和根 `.mcp.json`。当同一 Target 有多个实例时，unlink 必须指定 scope。

`harnessbrew doctor [formula]` 会校验 Cellar 文件摘要和每条 Target operation，区分目标缺失与被修改；`harnessbrew relink <formula>` 会在 Cellar 完整的前提下，按 Receipt 记录的 scope/root 强制重建 HarnessBrew 拥有的目标。可用 `--target`、`--scope` 和 `--project` 只修复一个实例。

也可以单独管理链接：

```bash
harnessbrew link code-review --target openai-codex
harnessbrew unlink code-review --target openai-codex
```

## Harnessfile

`Harnessfile` 适合提交到个人 dotfiles 或项目仓库：

```yaml
schemaVersion: 2
taps:
  - name: your-name/agents
    git: git@github.com:your-name/agent-assets.git
    ref: main
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

v2 的 Target placement 可以声明 `user` 或 `project` scope，并可使用相对于 `Harnessfile` 的 `project` 和 `root` 路径。
schema v1 的 `targets: [openai-codex]` 仍然兼容，并按 user scope 解释。

安装并生成 `Harnessfile.lock`：

```bash
harnessbrew bundle install
```

v2 lockfile 会记录 Manifest 摘要、HarnessBrew Adapter 版本、每个 Tap 的准确 commit、Formula 内容摘要、依赖闭包和完整 Target placement，
应与 `Harnessfile` 一起提交到 Git。

在其他设备运行同一命令时，HarnessBrew 会检出 lockfile 固定的 commit，而不是未经确认地使用 Tap 最新版本。
修改 v2 Harnessfile 后需要显式更新 lockfile：

```bash
harnessbrew bundle install --update-lock
```

清理清单之外的受管资产：

```bash
harnessbrew bundle cleanup
```

使用其他文件路径：

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

所有命令都可追加 `--json`，stdout 将只包含一个 schema v1 JSON envelope：`result` 是命令级结构化结果，`output` 保留人类文本，
失败时包含 `error.code`、`error.message`、`diagnostics` 和非零 `exitCode`。

变更命令可追加 `--dry-run`。HarnessBrew 会在同一 Home 写锁下完整执行校验和安装事务，收集每个路径的 before/after 类型与摘要，
随后回滚 Cellar、Receipt、Tap checkout 和 Agent Target；与 `--json` 组合时，预览位于 `changes` 数组。dry-run 可能执行 Git fetch/clone 等只读网络操作。

```bash
harnessbrew install code-review --target openai-codex --dry-run --json
```

## 本地目录

```text
~/.harnessbrew/
├── taps/       # HarnessBrew 管理的 Git 工作树
├── cellar/     # 按 Formula 与 commit 隔离的不可变内容
├── receipts/   # 安装、依赖、target 链接和摘要
└── state.json  # Tap 注册状态
```

Tap 工作树和 Cellar 内容都由 HarnessBrew 管理，不应直接编辑。个人资产应在原始 Tap 仓库中修改、提交和推送，再通过 `update`/`upgrade` 安装。

## 安全边界

- Formula 是声明式 JSON；HarnessBrew 不执行 Tap 中的任意脚本。
- 新注册的 Tap 默认不受信任：可以搜索和安装到 Cellar，但必须通过 `tap trust`、`tap add --trust` 或 Harnessfile v2 的 `trust: true` 才能链接或渲染到 Agent Target。旧状态记录按兼容策略视为已信任。
- Tap 更新默认只接受 Git fast-forward；仓库历史被重写时必须人工检查后使用 `--allow-rewind`。候选 commit 校验失败会恢复原 checkout 和状态。
- Formula 入口不能逃逸所属目录。
- 安装前会检查依赖、冲突和 target 兼容性。
- HarnessBrew 不覆盖未由 Receipt 管理的目标文件。
- 卸载前会检查 Cellar 文件摘要和符号链接目标。
- 私有 Tap 凭据由系统 Git/SSH credential 机制管理。

## 开发

项目使用 TypeScript 7.0，并启用严格类型检查。

```bash
npm ci
npm run build
npm test
npm run check
```

`npm run check` 会执行 TypeScript 编译、全部 Node.js 测试、安装包冒烟测试和 `npm pack --dry-run`。

## Target Adapter SDK

Node.js/TypeScript 宿主可以通过公开 API 注册第三方 Agent Target。Adapter API v1 只接收 Receipt 与 Target Context，并返回一条声明式安装计划；
实际写入、冲突检测、Receipt、doctor、relink、upgrade、dry-run 和回滚仍由 HarnessBrew transaction layer 负责。

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

SDK 会校验 API 版本、名称、版本、完整能力矩阵、计划身份、绝对目标路径和 Cellar source 边界。v1 的第三方 Adapter 计划只允许
`symlink-file`、`symlink-directory` 和 `unsupported`，不提供直接写文件或生成共享配置的操作。注册是显式、进程内操作；HarnessBrew 不会从 Tap
自动执行 Adapter Formula。第三方 Adapter 本身是具有宿主进程权限的可信代码，只应加载经过审查的 npm 包。

独立 CLI 可以持久化管理可信 Adapter 模块。模块需已通过 npm 安装并可被 `harnessbrew` 解析，也可以使用绝对路径或 `file://` URL；它必须默认导出
一个 Adapter，或提供名为 `adapter` 的导出：

```bash
harnessbrew adapter add @harnessbrew/adapter-cursor
harnessbrew adapter list
harnessbrew install review --target cursor
harnessbrew adapter remove cursor
```

`adapter add` 是一次显式的代码执行授权。HarnessBrew 将模块标识及审核时的 name、version、API version 写入
`~/.harnessbrew/adapters.json`；后续只在 install/link/unlink/relink/upgrade/bundle 需要 Target 时加载，并在每次加载时核对身份。
如果包升级改变身份，命令会关闭失败，要求先 remove、审查后再 add。`adapter list/remove` 本身不执行插件，HarnessBrew 也不会自动运行 `npm install`。
CLI 加载的 Target 同样进入 Harnessfile v2 lock 的 Adapter 签名。

## 架构

完整设计见 [docs/architecture.zh-CN.md](docs/architecture.zh-CN.md)。

## License

MIT
