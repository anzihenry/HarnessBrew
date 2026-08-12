# HarnessBrew Architecture

> 本文描述 HarnessBrew 的目标架构。当前实现会逐步从 workspace/asset 模型迁移到本文定义的 tap/formula/install 模型。

## 1. 产品定位

HarnessBrew 是面向 AI Agent 资产的 Git 包管理器，定位类似 Homebrew，而不是资产仓库或中心化 registry。

它负责发现、安装、组合、升级和删除 AI Agent 资产；资产内容由独立 Git 仓库维护。资产包括但不限于：

- skill
- agent
- workflow
- instruction / rule
- prompt
- MCP server 配置
- adapter 和其他 Agent 扩展

HarnessBrew 自身不拥有用户资产。个人资产与第三方资产使用同一套 Git 来源机制，区别仅在仓库所有权、写权限与信任级别。

## 2. 设计原则

1. **Git 是唯一版本事实来源**：提交、tag 和分支负责历史、版本与回滚，不在资产内部重复维护快照。
2. **所有资产源一视同仁**：个人、团队和第三方资产都来自 Git tap。
3. **声明与安装分离**：formula 描述资产，Cellar 保存安装实例，adapter 负责投递到目标 Agent。
4. **安装必须可逆**：每次安装都生成 receipt；卸载只删除 HarnessBrew 拥有的文件，并能检测冲突。
5. **结果必须可复现**：声明文件表达期望状态，lock 文件固定实际 Git commit 和解析后的依赖版本。
6. **目标平台解耦**：同一资产通过 adapter 安装到 Codex、Claude Code、Cursor 等不同环境。
7. **默认不执行不受信任代码**：第三方 formula 和资产首先视为数据；需要执行脚本时必须显式声明并获得授权。

## 3. Homebrew 概念映射

| Homebrew | HarnessBrew | 含义 |
| --- | --- | --- |
| `brew` | `harnessbrew` | 包管理 CLI |
| Tap | Tap | Git 资产源仓库 |
| Formula / Cask | Formula | 一个可安装的 Agent 资产配方 |
| Cellar | Cellar | 按来源和版本隔离的本地安装区 |
| Link | Target link | 投递到具体 Agent 的文件或配置 |
| `Brewfile` | `Harnessfile` | 可提交到 Git 的期望资产清单 |
| installed receipt | Receipt | 安装结果、文件归属和来源记录 |

## 4. 系统拓扑

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

控制面由 tap、formula、`Harnessfile` 和 lockfile 构成；数据面由 Cellar 中的不可变安装内容及其到目标 Agent 的链接或渲染结果构成。

## 5. 核心领域模型

### 5.1 Tap

Tap 是一个可独立克隆和更新的 Git 仓库，也是资产发布、协作和版本治理的基本边界。

推荐按“资产集合”建立仓库，而不是每个 skill 或 workflow 建立一个仓库：

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

Tap 标识采用 `<owner>/<name>`，例如：

- `xiejinheng/agents`：个人资产
- `company/engineering-agents`：团队资产
- `community/workflows`：第三方资产

`harnessbrew tap` 只注册 Git 来源；Tap 的 clone、fetch、checkout 和缓存由 HarnessBrew 管理。

### 5.2 Formula

Formula 描述一个可安装资产，不承载 Git 已经提供的历史记录。最小示例：

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
  ]
}
```

完整资产坐标为 `<tap>/<formula>`，例如 `xiejinheng/agents/code-review`。若短名称能唯一解析，CLI 可以接受 `code-review`；出现歧义时必须要求完整坐标。

Formula 可以声明：

- 资产类型和入口文件
- 支持的 target
- 依赖资产
- 安装或渲染参数
- 冲突项和弃用信息
- 完整性校验信息
- 必要时显式声明的安装 hook

Formula 不应维护 `.snapshots`、`history` 或人为复制的内容版本；这些信息来自所属 Tap 的 commit 和 tag。

### 5.3 Cellar 与 Receipt

Cellar 保存解析后、按来源和版本隔离的安装实例。示意结构：

```text
~/.harnessbrew/
├── taps/
│   └── xiejinheng/agents/       # Git 工作树或受管缓存
├── cellar/
│   └── xiejinheng/agents/code-review/<commit>/
├── receipts/
│   └── xiejinheng/agents/code-review.json
└── state.json
```

Receipt 至少记录：

- 完整资产坐标
- Tap URL、ref 与解析后的 commit SHA
- 依赖闭包
- 安装 target
- Cellar 路径
- 创建、链接或渲染出的文件
- 文件摘要与安装时间

Receipt schema v2 以操作清单记录 Target 副作用。每条操作包含稳定 ID、操作类型、Target、目标路径、可选源路径、安装后摘要、受管配置键或区块标记，以及本次创建的父目录。v2 支持目录软链、文件软链、渲染文件、配置合并和受管区块；读取 schema v1 时会把旧 `links` 规范化为文件软链操作，以保证已有安装可以继续校验、升级和卸载。

Receipt 是安全卸载和冲突检测的依据。HarnessBrew 不应删除 receipt 未声明拥有的文件；若用户修改了已安装文件，应先报告差异，再由用户决定覆盖、保留或强制删除。

### 5.4 Harnessfile 与 Lockfile

`Harnessfile` 描述用户希望安装的顶层资产，可提交到个人配置仓库或项目仓库：

```yaml
taps:
  - name: xiejinheng/agents
    git: git@github.com:xiejinheng/agent-assets.git

assets:
  - formula: xiejinheng/agents/code-review
    targets: [openai-codex]
```

Lockfile 由 HarnessBrew 生成并提交到 Git，记录：

- 每个 Tap 的准确 commit SHA
- 每个 formula 的来源与内容摘要
- 完整依赖闭包
- 解析时使用的 adapter 版本

`harnessbrew bundle install` 应根据 lockfile 重建相同环境；只有显式 update/upgrade 才更新锁定结果。

### 5.5 Target 与 Adapter

Target 表示具体 Agent 环境，例如 `openai-codex`、`claude-code` 或 `cursor`。Adapter 负责：

- 校验资产与 target 是否兼容
- 把统一 formula 映射到目标目录和文件格式
- 渲染 target 特有配置
- 生成待安装文件清单
- 与 linker 协作创建链接或受管副本
- 在卸载前校验文件归属和摘要

Adapter 只处理平台差异，不负责 Git 版本管理或依赖求解。

#### Target 能力矩阵

Target Adapter 必须为每一种 Formula 类型声明确定的安装策略。不允许通过 `${kind}s` 猜测目标目录；没有平台依据的组合必须明确标记为 `unsupported`。

| Formula | OpenAI Codex | Claude Code |
| --- | --- | --- |
| `skill` | `symlink-directory` | `symlink-directory` |
| `workflow` | `render-skill` | `render-skill` |
| `agent` | `render-file` | `render-file` |
| `instruction` | `managed-block` | `symlink-file` |
| `prompt` | `render-skill` | `render-skill` |
| `mcp` | `merge-config` | `merge-config` |
| `adapter` | `unsupported` | `unsupported` |

策略含义：

- `symlink-directory`：将完整资产目录链接到 Target，保留脚本、引用和模板等相对资源。
- `symlink-file`：链接单个 Target 原生文件。
- `render-file`：由 Adapter 生成 Target 原生格式。
- `render-skill`：将统一 Workflow 或 Prompt 投影为 Target Skill。
- `managed-block`：在共享配置文件中维护带所有权标记的内容区块。
- `merge-config`：按配置键合并，并在 Receipt 中记录键级所有权。
- `unsupported`：拒绝投递；资产仍可保存在 Cellar 中。

Skill 必须使用以 `SKILL.md` 为入口的标准目录结构。Codex 用户级 Skill 投递到 `~/.agents/skills/<name>`，Claude Code 用户级 Skill 投递到 `~/.claude/skills/<name>`；两者都链接完整 Cellar 目录，而不是只链接入口文件，以保留 `scripts/`、`references/` 和 `assets/` 等相对资源。

Agent Formula 使用统一 Markdown 入口作为可移植源码。Adapter 读取 Formula 的名称、描述与正文，确定性生成 Target 原生文件：Codex 写入 `~/.codex/agents/<name>.toml`，Claude Code 写入 `~/.claude/agents/<name>.md`。渲染文件的摘要与操作所有权记录在 Receipt 中；重复 link 会验证摘要，upgrade 会从新版本源码重新生成，检测到用户修改时默认拒绝覆盖或删除。

Instruction Formula 同样使用 Markdown 入口。Codex Adapter 将内容写入 `~/.codex/AGENTS.md` 中以 Formula 坐标命名的受管区块，允许多个资产和用户原有内容安全共存；Claude Code Adapter 将入口软链到 `~/.claude/rules/<name>.md`。Receipt 记录区块标记和内容摘要，因而 unlink、uninstall 和 upgrade 只处理 HarnessBrew 拥有的区块，并在区块被修改时默认中止。

Workflow 与 Prompt Formula 通过 `render-skill` 统一投影为 `<target-skill-root>/<name>/SKILL.md`。生成文件包含标准的 `name`、`description` frontmatter，以及记录原始 Formula 类型和坐标的 HarnessBrew metadata；正文保持为 Formula 的 Markdown 入口。Codex 和 Claude Code 使用相同的可移植投影模型，不依赖某个平台专有且可能废弃的 commands 目录。

MCP Formula 使用统一 JSON 描述 stdio 或 HTTP transport。凭据字段只能引用环境变量名称：stdio 使用 `envVars`，HTTP 使用 `bearerTokenEnvVar` 和 `headersFromEnv`，不允许 Formula 保存明文密钥。Codex Adapter 在 `config.toml` 中生成带坐标标记的 `[mcp_servers.<name>]` 区块；Claude Code Adapter 合并 `.claude.json` 或项目 `.mcp.json` 的 `mcpServers.<name>` 键。Receipt 保存区块/键所有权及值摘要，冲突键、拥有值篡改和无效配置都会中止操作，卸载只移除对应键或区块。

Adapter Formula 在当前版本仅作为 Git/Cellar 资产保存，不允许投递到任何内置 Target。执行层必须根据能力矩阵返回明确的 `unsupported` 错误，不得退回通用目录或 `${kind}s` 路径。未来只有经过版本化插件接口加载的 Adapter 才能参与安装计划。

## 6. 主要生命周期

### 6.1 注册资产源

```bash
harnessbrew tap xiejinheng/agents git@github.com:xiejinheng/agent-assets.git
harnessbrew tap community/workflows https://github.com/community/agent-workflows.git
```

流程：注册 URL、克隆或获取 Tap、校验 `tap.json` 和 formula、建立本地索引。

### 6.2 安装

```bash
harnessbrew install xiejinheng/agents/code-review --target openai-codex
```

流程：

1. 解析名称、ref 和 Git commit。
2. 读取 formula 并求解依赖闭包。
3. 校验 target 兼容性、信任策略与文件冲突。
4. 将不可变内容放入 Cellar。
5. 由 adapter 生成安装计划。
6. 链接或渲染到目标 Agent。
7. 写入 receipt 和 lock 状态。

任何步骤失败都应回滚本次已创建的文件。

### 6.3 更新与升级

```bash
harnessbrew update
harnessbrew outdated
harnessbrew upgrade code-review
```

- `update` 获取 Tap 的最新 Git 状态和索引，不直接修改已安装资产。
- `outdated` 比较已安装 commit、当前约束和可用版本。
- `upgrade` 展示来源及内容差异，安装新版本，更新链接、receipt 和 lockfile。

### 6.4 卸载

```bash
harnessbrew uninstall code-review
```

流程：读取 receipt、检查反向依赖和本地修改、移除 HarnessBrew 拥有的 target 文件、清理无引用 Cellar 实例并更新状态。移除资产不等于移除 Tap；只有 `untap` 才删除资产源注册和本地缓存。

### 6.5 环境重建

```bash
harnessbrew bundle install
harnessbrew bundle cleanup
```

- `bundle install` 将本机收敛到 `Harnessfile` 与 lockfile 声明的状态。
- `bundle cleanup` 列出并可选择移除清单之外的受管资产。

## 7. 分层架构

### CLI layer

解析命令和参数，展示安装计划、diff、冲突与操作结果，不直接操作目标 Agent 文件。

### Tap and Git layer

管理 Tap 注册、clone/fetch/checkout、ref 解析、commit 锁定、本地缓存和 Git 差异。

### Catalog layer

发现并校验 formula，建立名称、类型、tag、target 和弃用状态索引。

### Resolver layer

解析资产坐标和依赖图，处理缺失依赖、循环依赖、版本约束、冲突和 target 兼容性。

### Cellar and state layer

管理不可变安装实例、receipt、lockfile、引用计数和垃圾清理。

### Adapter layer

把统一资产模型转换成目标 Agent 的目录结构和配置格式，输出确定性的安装计划。

### Transaction layer

执行文件创建、链接、替换和删除；负责冲突检测、摘要校验、回滚与安全卸载。

## 8. Git 与版本策略

HarnessBrew 使用以下优先级解析版本：

1. Lockfile 中的 commit SHA，用于可复现安装。
2. 用户声明的 Git tag 或 commit。
3. 用户声明的分支。
4. Tap 默认分支。

版本展示可以使用语义化 tag，但内部安装身份始终包含不可变 commit SHA。分支名不是稳定版本，只代表升级时要跟踪的更新通道。

个人资产的推荐发布流程：

1. 在个人 Tap 中编辑 formula 和内容。
2. 使用普通 Git commit 管理变更。
3. 可选地创建语义化 tag 作为稳定发布点。
4. 在消费环境中运行 `update` 和 `upgrade`。
5. 审阅 diff 后更新 lockfile。

## 9. 安全和所有权边界

- Tap 内容默认视为不受信任输入。
- Formula 使用声明式数据格式，不默认加载 Tap 中的可执行代码。
- 安装前展示将要写入的 target 和文件列表。
- 安装 hook 必须声明能力并单独授权。
- Receipt 必须保存文件摘要，用于检测安装后的用户修改。
- 卸载只能处理 Cellar 和 receipt 明确记录的路径。
- 同一路径只能有一个明确所有者；冲突必须在写入前解决。
- 私有 Tap 的凭据交给系统 Git/SSH credential 管理，HarnessBrew 不保存密钥。

## 10. 插件方向

Agent 平台变化应与核心包管理能力解耦。Adapter 最终以插件形式提供，例如：

- `@harnessbrew/adapter-openai-codex`
- `@harnessbrew/adapter-claude-code`
- `@harnessbrew/adapter-cursor`

插件接口应以“输入 formula、依赖闭包和 target 配置，输出确定性安装计划”为核心。插件不能绕过 transaction layer 直接修改任意文件。

## 11. HarnessBrew 的边界

HarnessBrew 负责：

- 管理 Git Tap
- 发现和校验 formula
- 解析依赖和兼容性
- 安装、升级和安全卸载资产
- 管理 Cellar、receipt、Harnessfile 和 lockfile
- 适配不同 Agent 平台

HarnessBrew 不负责：

- 托管用户资产或充当 Git 服务
- 替代 Git 的历史、分支、tag 和协作能力
- 在 formula 中重复维护资产快照历史
- 默认执行第三方仓库中的任意脚本
- 修改或删除不属于 HarnessBrew 的用户文件

一句话概括：

> HarnessBrew 不拥有资产；它通过 Git 发现、安装、组合、升级和删除 AI Agent 资产。
