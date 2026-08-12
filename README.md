# HarnessBrew

HarnessBrew 是面向 AI Agent 资产的 Git 包管理器。它的定位类似 Homebrew：通过 Git Tap 发现资产，通过 Formula 描述资产，通过 Cellar 与 Receipt 安装、升级和安全卸载资产。

HarnessBrew 不托管资产。个人、团队和第三方资产都保存在各自的 Git 仓库中，并使用完全相同的安装机制。

## 主要能力

- 注册、更新和移除 Git Tap
- 校验并搜索 skill、agent、workflow、instruction、prompt、MCP 和 adapter Formula
- 解析依赖、循环、缺失项与冲突
- 按 Git commit 将不可变内容安装到 Cellar
- 链接到 OpenAI Codex 和 Claude Code
- 通过 Receipt 跟踪文件所有权和 SHA-256 摘要
- 检测可用升级，并在升级后保留 Agent target 链接
- 使用 `Harnessfile` 和 lockfile 在不同设备上复现环境
- 从 npm 安装并通过 GitHub Release 发布

## 安装

要求：Node.js 20 或更高版本，系统中可用 Git。

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
harnessbrew tap add xiejinheng/agents git@github.com:xiejinheng/agent-assets.git
```

搜索并查看 Formula：

```bash
harnessbrew search review
harnessbrew search --kind skill --target openai-codex
harnessbrew info xiejinheng/agents/code-review
```

安装到 Cellar，并链接到 Codex：

```bash
harnessbrew install xiejinheng/agents/code-review \
  --target openai-codex
```

如果只希望保存到 Cellar，不写入 Agent 配置目录，可以省略 `--target`。

更新和升级：

```bash
harnessbrew update
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
    "xiejinheng/agents/repository-guardrails"
  ],
  "conflicts": [],
  "tags": ["review", "quality"]
}
```

完整坐标为 `<owner>/<tap>/<formula>`。依赖和冲突必须使用完整坐标，以避免跨 Tap 名称歧义。

Git commit 是安装版本的唯一事实来源；Formula 不维护 `.snapshots` 或重复的 `history`。

## Target

当前内置：

- `openai-codex`
- `claude-code`

可以在安装时指定 target：

```bash
harnessbrew install code-review --target openai-codex
```

Codex Skill 默认安装到 `~/.agents/skills`，其他 Codex 配置使用 `~/.codex`；Claude Code 使用 `~/.claude`。Skill 以完整目录软链安装，因此 `scripts/`、`references/` 和 `assets/` 等相对资源会与 `SKILL.md` 一起生效。Workflow 和 Prompt 会被投影为带标准 frontmatter 的 Target Skill。Agent 则以统一 Markdown 作为源码：投递到 Codex 时确定性渲染为 `.codex/agents/<name>.toml`，投递到 Claude Code 时渲染为 `.claude/agents/<name>.md`。Instruction 在 Codex 的 `AGENTS.md` 中使用带所有权标记的受管区块，在 Claude Code 中链接为 `.claude/rules/<name>.md`；卸载不会覆盖共享文件中的用户内容。需要隔离安装时可使用：

```bash
harnessbrew install code-review \
  --target openai-codex \
  --target-root /path/to/sandbox/.codex
```

也可以单独管理链接：

```bash
harnessbrew link code-review --target openai-codex
harnessbrew unlink code-review --target openai-codex
```

## Harnessfile

`Harnessfile` 适合提交到个人 dotfiles 或项目仓库：

```yaml
schemaVersion: 1
taps:
  - name: xiejinheng/agents
    git: git@github.com:xiejinheng/agent-assets.git
    ref: main

assets:
  - formula: xiejinheng/agents/code-review
    targets: [openai-codex]
```

安装并生成 `Harnessfile.lock`：

```bash
harnessbrew bundle install
```

lockfile 会记录每个 Tap 的准确 commit、依赖闭包和 target，应与 `Harnessfile` 一起提交到 Git。

在其他设备运行同一命令时，HarnessBrew 会检出 lockfile 固定的 commit，而不是未经确认地使用 Tap 最新版本。

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
harnessbrew tap add <owner/name> <git-url> [--ref <ref>]
harnessbrew tap list
harnessbrew tap update [owner/name]
harnessbrew tap remove <owner/name>
harnessbrew untap <owner/name>
harnessbrew search [query] [--kind <kind>] [--target <target>]
harnessbrew info <formula>
harnessbrew install <formula> [--target <target>] [--target-root <path>]
harnessbrew list
harnessbrew link <formula> --target <target> [--target-root <path>]
harnessbrew unlink <formula> --target <target> [--force]
harnessbrew update
harnessbrew outdated
harnessbrew upgrade [formula]
harnessbrew uninstall <formula> [--force]
harnessbrew bundle install [--file <path>]
harnessbrew bundle cleanup [--file <path>]
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

## 架构

完整设计见 [docs/architecture.md](docs/architecture.md)。

## License

MIT
