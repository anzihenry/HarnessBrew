# HarnessBrew

HarnessBrew 是面向个人的 Agent 资产库和工作流包管理器。它的目标是沉淀你自己的 instructions、skills 与 agents，并安全地导入、审查、版本化和安装第三方工作流资产。

- 统一管理 `agents`、`skills`、`instructions` 等资产
- 为资产附带版本元数据、来源信息和依赖关系，支持演进、追踪与审查
- 面向不同 Agent 运行时，按各自配置规范安装或导出

当前仓库提供的是一个零依赖 Node.js CLI，加上一套可扩展的资产模型与适配层。当前仓库基线版本是 `0.3.0`，已具备资产维护、依赖治理和可验证发布物能力；第三方导入、原生安装器与来源追踪是下一阶段重点。

## 解决的问题

随着 Agent 工程逐步复杂，团队通常会遇到这些问题：

- 资产分散在不同目录，难以统一治理
- 同一份能力描述需要适配多个 Agent 平台，格式不一致
- 提示词、技能说明、执行指令随着版本演进，缺少统一元数据
- 团队很难知道“哪份资产是当前生效版本”

Harness 的设计目标是把这些内容收敛成一个可管理、可导出、可扩展的资产工作区。

## 当前能力

### 1. 资产类型

当前支持三类基础资产：

- `agent`
- `skill`
- `instruction`

每个资产都带有统一元数据：

- `id`
- `name`
- `kind`
- `version`
- `description`
- `status`
- `tags`
- `owner`
- `compatibility`
- `dependencies`
- `content`
- `history`

### 2. Agent 适配导出

当前内置三种导出适配器：

- `generic`
- `openai-codex`
- `claude-code`

工作区也可以通过 `.harnessbrew/workspace.json` 中的 `adapterModules` 挂载本地 adapter 模块，为仓库新增自定义 target。

适配器会把统一资产模型转换成目标 Agent 更容易消费的结构，例如：

- `openai-codex` 输出更贴近 instructions / tools / assets 的组织方式
- `claude-code` 输出更贴近 system prompt / skills / metadata 的组织方式
- `generic` 输出保持最小抽象，适合二次加工

### 3. 版本治理

第一版先实现“资产级版本元数据”：

- 每个资产有独立 `version`
- 每个资产维护 `history`
- 工作区记录支持的 Agent target 与导出配置

后续可以继续扩展：

- 资产锁定与发布标签
- 版本 diff
- 多环境推广
- registry / remote sync

`0.2.0` 起，资产模型开始支持 `dependencies`，用来声明一个 agent、skill 或 instruction 依赖的其他资产。当前 `validate` 已会检查依赖是否存在、是否重复、是否出现循环引用，以及依赖资产是否覆盖调用方声明的 compatibility targets。

## 目录结构

```text
.
├── .harnessbrew/
│   └── workspace.json
├── assets/
│   ├── agents/
│   ├── skills/
│   └── instructions/
├── exports/
├── src/
│   ├── cli.js
│   ├── core/
│   │   ├── adapters.js
│   │   ├── paths.js
│   │   └── workspace.js
│   └── utils/
│       └── json.js
└── docs/
    └── architecture.md
```

## 从 Harness 迁移

HarnessBrew 将工作区配置目录从 `.harness/` 更名为 `.harnessbrew/`，CLI 命令也从 `harness` 更名为 `harnessbrew`。升级已有工作区时，先将 `.harness/` 移动为 `.harnessbrew/`，再使用新命令运行 `validate`。

## 快速开始

要求：Node.js 18+

下面这组命令可以直接在当前仓库运行，用来巡检现有工作区、查看依赖图，并生成可验证的 bundle：

```bash
node ./src/cli.js --version
node ./src/cli.js list
node ./src/cli.js list --kind skill --json
node ./src/cli.js list --group-by owner
node ./src/cli.js list --status archived
node ./src/cli.js targets
node ./src/cli.js validate --json
node ./src/cli.js deps agent agent.harness-manager --json
node ./src/cli.js dependents skill skill.prompt-authoring --json
node ./src/cli.js orphans --kind skill --json
node ./src/cli.js impact skill skill.prompt-authoring --json
node ./src/cli.js history skill skill.agent-review --json
node ./src/cli.js show skill skill.prompt-authoring --metadata
node ./src/cli.js show skill skill.prompt-authoring --content
node ./src/cli.js show agent agent.harness-manager --resolved
node ./src/cli.js show skill skill.prompt-authoring
node ./src/cli.js export generic --entry agent:agent.harness-manager --include-dependencies --json
node ./src/cli.js pack generic --entry agent:agent.harness-manager --include-dependencies --json
node ./src/cli.js pack generic --entry agent:agent.harness-manager --channel stable
node ./src/cli.js pack generic --entry agent:agent.harness-manager --archive
node ./src/cli.js verify-bundle releases/agent.harness-manager-generic --json
node ./src/cli.js export openai-codex --json
```

导出结果默认写入 `.harnessbrew/workspace.json` 中 `exportDirectory` 指定的目录；当前默认值是 `exports/<target>.json`。

## 命令说明

### `--version`

输出当前 Harness CLI 版本。

```bash
node ./src/cli.js --version
```

### `init`

初始化工作区目录与示例资产。若工作区已存在，命令会拒绝覆盖；只有显式传入 `--force` 时才会重写现有工作区文件。

```bash
node ./src/cli.js init
node ./src/cli.js init --force
```

### `list`

列出当前工作区中的资产，并支持按类型、标签、归属人、状态和 target 过滤；传入 `--group-by kind|owner|target` 时可切换分组方式；传入 `--json` 时返回机器可读结构。

```bash
node ./src/cli.js list
node ./src/cli.js list --kind skill
node ./src/cli.js list --tag review --owner team-harness
node ./src/cli.js list --status archived
node ./src/cli.js list --group-by owner
node ./src/cli.js list --target openai-codex --json
```

### `targets`

列出当前工作区可用的全部导出 targets，包括内置 adapter 和通过 `adapterModules` 加载的本地 adapter。

```bash
node ./src/cli.js targets
```

### `validate`

校验工作区配置、资产元数据、内容文件、依赖关系和版本快照是否完整。当前版本会额外校验 `timezone`、history 完整性、compatibility target 重复项、snapshot metadata 与 live asset 的一致性，以及 dependency 缺失、循环和 target 不兼容问题。传入 `--json` 时返回稳定的机器可读结果，并在校验失败时保持非零退出码。

```bash
node ./src/cli.js validate
node ./src/cli.js validate --json
```

### `new <kind> <id>`

创建一个新资产，同时初始化 `asset.json`、`content.md` 和首个版本快照。

```bash
node ./src/cli.js new skill skill.agent-review \
  --name "Agent Review" \
  --description "Review checklist for agent changes" \
  --owner team-harness \
  --tags review,quality
```

如果想练习创建、编辑、依赖维护和归档流程，建议先在临时目录初始化一个独立 Harness 工作区：

```bash
mkdir -p /tmp/harness-demo
cd /tmp/harness-demo
node /Users/xiejinheng/Coding/Harness/src/cli.js init
node /Users/xiejinheng/Coding/Harness/src/cli.js new skill skill.release-checklist --owner team-harness --tags release,quality
node /Users/xiejinheng/Coding/Harness/src/cli.js set skill skill.release-checklist --description "Release readiness checklist"
node /Users/xiejinheng/Coding/Harness/src/cli.js add-dependency skill skill.release-checklist instruction instruction.repository-guardrails --optional
node /Users/xiejinheng/Coding/Harness/src/cli.js deps skill skill.release-checklist
node /Users/xiejinheng/Coding/Harness/src/cli.js remove-dependency skill skill.release-checklist instruction instruction.repository-guardrails
node /Users/xiejinheng/Coding/Harness/src/cli.js archive skill skill.release-checklist --reason "Demo complete"
```

### `clone <kind> <source-id> <target-id>`

复制同类型资产，保留源资产的正文、tags、owner、compatibility 和 dependencies，并为目标资产创建新的 `id`、`name`、`version`、history 和首个 snapshot。

```bash
node ./src/cli.js clone skill skill.prompt-authoring skill.prompt-authoring-copy
node ./src/cli.js clone agent agent.harness-manager agent.platform-manager --name "Platform Manager" --version 0.1.0
```

### `archive <kind> <id>`

把资产标记为 `status: "archived"`，并记录归档原因。若资产仍被其他资产依赖，命令会阻断归档，避免破坏已有组合关系。默认 `list` 仍会显示归档资产；可以用 `list --status archived` 只查看归档资产。

```bash
node ./src/cli.js archive skill skill.prompt-authoring-copy --reason "Folded into prompt-authoring"
node ./src/cli.js list --status archived
```

### `set <kind> <id>`

更新资产 metadata，并保留当前 `version`、`history` 和正文内容。当前支持更新 `name`、`description`、`owner`、`tags` 和 `compatibility.targets`。

```bash
node ./src/cli.js set skill skill.agent-review --owner team-platform
node ./src/cli.js set skill skill.agent-review --tags review,quality
node ./src/cli.js set skill skill.agent-review --targets generic,openai-codex
```

### `add-dependency <kind> <id> <dependency-kind> <dependency-id>`

为资产添加依赖关系。默认写入 `required: true`；传入 `--optional` 时写入 `required: false`。命令会拒绝不存在的依赖资产、重复依赖、循环依赖，以及 target compatibility 不匹配的依赖。

```bash
node ./src/cli.js add-dependency skill skill.agent-review instruction instruction.repository-guardrails --optional
```

### `remove-dependency <kind> <id> <dependency-kind> <dependency-id>`

从资产 metadata 中移除指定依赖关系。依赖不存在时会返回清晰错误。

```bash
node ./src/cli.js remove-dependency skill skill.agent-review instruction instruction.repository-guardrails
```

### `bump-version <kind> <id> <version>`

更新资产版本，并把当前内容固化为新的版本快照。

```bash
node ./src/cli.js bump-version skill skill.agent-review 1.1.0 --note "Expanded review checklist"
```

### `diff <kind> <id> <from-version> [to-version]`

比较两个版本的 metadata 和正文内容。若省略 `to-version`，默认对比到当前版本。传入 `--json` 时返回结构化 diff 结果。

```bash
node ./src/cli.js diff skill skill.agent-review 1.0.0 1.1.0
node ./src/cli.js diff skill skill.agent-review 1.0.0
node ./src/cli.js diff skill skill.agent-review 1.0.0 1.1.0 --json
```

### `deps <kind> <id>`

查看指定资产的直接依赖、递归解析出的依赖资产、缺失依赖和循环依赖。传入 `--json` 时返回结构化依赖图，字段包括 `directDependencies`、`resolvedAssets`、`missing` 和 `cycles`。

```bash
node ./src/cli.js deps agent agent.harness-manager
node ./src/cli.js deps agent agent.harness-manager --json
```

### `dependents <kind> <id>`

查看哪些资产直接或递归依赖了指定资产。传入 `--json` 时返回 `directDependents`、`upstreamAssets` 和依赖路径 `paths`。

```bash
node ./src/cli.js dependents skill skill.prompt-authoring
node ./src/cli.js dependents skill skill.prompt-authoring --json
```

### `orphans`

列出没有被任何资产引用的非入口资产。当前默认把 `agent` 视为入口资产，因此不会把未被引用的 agent 当作 orphan；可以用 `--kind` 只查看某一类资产。

```bash
node ./src/cli.js orphans
node ./src/cli.js orphans --kind skill --json
```

### `impact <kind> <id>`

分析修改指定资产会影响哪些上游资产和入口 agent，并给出建议重新打包的 entry。当前支持资产级分析，后续可以扩展到 `--changed <path>`。

```bash
node ./src/cli.js impact skill skill.prompt-authoring
node ./src/cli.js impact skill skill.prompt-authoring --json
```

### `history <kind> <id>`

查看指定资产的版本时间线。当前版本会用 `*` 标记，并显示对应 snapshot 路径。传入 `--json` 时返回结构化历史结果。

```bash
node ./src/cli.js history skill skill.prompt-authoring
node ./src/cli.js history skill skill.prompt-authoring --json
```

### `show <kind> <id> [version] [--metadata|--content|--resolved]`

查看指定资产的完整内容；如果传入版本号，则返回对应 snapshot 的内容。也可以只看 metadata、正文内容，或通过 `--resolved` 查看解析后的依赖树与依赖图。

```bash
node ./src/cli.js show instruction instruction.repository-guardrails
node ./src/cli.js show agent agent.harness-manager --resolved
node ./src/cli.js show skill skill.prompt-authoring 1.0.0
node ./src/cli.js show skill skill.prompt-authoring --metadata
node ./src/cli.js show skill skill.prompt-authoring --content
```

### `export [target]`

按目标 Agent 规范导出配置，输出目录由工作区配置中的 `exportDirectory` 决定。若省略 `target`，默认使用工作区配置中的 `defaultTarget`。传入 `--entry <kind:id>` 时可只导出指定入口资产；再加 `--include-dependencies` 时会把依赖闭包一并带上。传入 `--json` 时返回结构化导出结果。

```bash
node ./src/cli.js export
node ./src/cli.js export generic
node ./src/cli.js export generic --entry skill:skill.prompt-authoring
node ./src/cli.js export generic --entry agent:agent.harness-manager --include-dependencies --json
node ./src/cli.js export openai-codex --json
node ./src/cli.js export claude-code
```

### `pack [target]`

生成面向交付的 bundle 目录，而不只是单个 target 的导出结果。`pack` 需要 `--entry <kind:id>`，并会写出 `manifest.json`、`assets.json`、`rendered/<target>.json` 和 `checksums.json`。如果再加 `--include-dependencies`，会把依赖闭包一并打包。默认 channel 是 `draft`；传入 `--channel stable` 时会先要求工作区通过 `validate`。传入 `--archive` 时会额外生成 `<bundle>.tar.gz`，便于分发。

```bash
node ./src/cli.js pack generic --entry agent:agent.harness-manager
node ./src/cli.js pack generic --entry agent:agent.harness-manager --include-dependencies --json
node ./src/cli.js pack generic --entry agent:agent.harness-manager --channel stable
node ./src/cli.js pack generic --entry agent:agent.harness-manager --archive
node ./src/cli.js pack openai-codex --entry agent:agent.harness-manager --output releases/harness-manager-codex
```

### `verify-bundle <bundle-path>`

校验 `pack` 生成的 bundle 是否完整可信。当前会检查必需文件、`checksums.json` 中的 digest、manifest 中的 digest 记录，以及 manifest 的资产版本集合是否与 `assets.json` 一致。

```bash
node ./src/cli.js verify-bundle releases/agent.harness-manager-generic
node ./src/cli.js verify-bundle releases/agent.harness-manager-generic --json
```

## 设计原则

- 先统一内部模型，再做外部适配
- 资产与适配器解耦
- 版本信息与内容本体并存
- 本地优先，后续再接远端 registry

## 本地 Adapter 扩展

如果你想为某个团队内 Agent 运行时增加专用导出格式，可以在工作区里声明本地 adapter 模块：

```json
{
  "supportedTargets": ["generic", "json-lines"],
  "defaultTarget": "generic",
  "adapterModules": ["adapters/json-lines.js"]
}
```

示例模块：

```js
export default {
  target: "json-lines",
  render(workspace, assets) {
    return assets.map((asset) => ({
      workspace: workspace.name,
      id: asset.id,
      kind: asset.kind,
      version: asset.version
    }));
  }
};
```

## Release / Versioning

Harness 当前有三层版本语义：

- 项目版本：`package.json` 和 `.harnessbrew/workspace.json` 中的 `version`，表示当前工具/工作区基线版本。
- 资产版本：每个 asset 自己的 `version` 和 `history`，用于跟踪单个 agent、skill、instruction 的演进。
- Git 版本标签：用于标记某一份完整仓库代码快照，例如 `v0.1.0`、`v0.1.1`、`v0.2.0`、`v0.3.0`。

推荐的使用方式：

1. 用 asset 级 `version` 管理单个资产内容变化。
2. 当工具能力或工作区基线达到一个可发布节点时，更新项目级 `version`。
3. 在 Git 中为该提交打 tag，例如 `v0.1.0`、`v0.1.1`、`v0.2.0`、`v0.3.0`，作为正式 release 锚点。

发布前建议至少执行：

```bash
node ./src/cli.js --version
npm run check
```

建议的 `0.3.0` 发版步骤：

```bash
node ./src/cli.js --version
node ./src/cli.js validate
npm run check
git add package.json .harnessbrew/workspace.json CHANGELOG.md README.md docs/release-0.3.0.md docs/walkthrough-asset-to-bundle.md
git commit -m "release: prepare 0.3.0"
git tag -a v0.3.0 -m "Release 0.3.0"
git push origin main --follow-tags
```

对当前仓库来说：

- `0.1.0` 表示第一版可用 MVP 基线。
- `v0.1.0` 对应的是当前这份已发布到远端的代码快照。
- `0.2.0` 聚焦依赖建模、结构化查询、局部导出和 bundle 打包。
- `0.3.0` 聚焦资产维护入口、依赖图治理和可验证 release artifact。

## Roadmap / Release Docs

- [Harness 0.3.0 Planning](/Users/xiejinheng/Coding/Harness/docs/roadmap-0.3.0.md)
- [Harness 0.3.0 Task Breakdown](/Users/xiejinheng/Coding/Harness/docs/roadmap-0.3.0-tasks.md)
- [Asset-to-Bundle Walkthrough](/Users/xiejinheng/Coding/Harness/docs/walkthrough-asset-to-bundle.md)
- [Harness 0.3.0 Release Prep](/Users/xiejinheng/Coding/Harness/docs/release-0.3.0.md)
- [Architecture](/Users/xiejinheng/Coding/Harness/docs/architecture.md)

## 下一步建议

`0.3.0` 已完成资产维护、依赖图治理、发布物强化和发布准备。接下来建议推进：

1. 为 `verify-bundle` 增加更多损坏场景 fixture。
2. 设计 registry / remote sync 的最小可行模型。
3. 评估 adapter 插件化和配置发现机制。
