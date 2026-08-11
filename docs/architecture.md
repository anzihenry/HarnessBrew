# HarnessBrew Architecture

## 1. Core idea

HarnessBrew 的核心思路是把 Agent 生态里的各种“可复用能力资产”沉淀为个人资产库，再根据目标 Agent 的约束进行安装或导出。

统一对象带来的好处：

- 资产管理方式一致
- 版本治理方式一致
- 能在多个 Agent 平台之间复用
- 可以逐步演进为团队级 registry

## 2. Domain model

每个资产都遵循统一结构：

```json
{
  "id": "skill.prompt-authoring",
  "name": "Prompt Authoring",
  "kind": "skill",
  "version": "1.0.0",
  "description": "Reusable guidance for writing prompts.",
  "tags": ["prompt", "authoring"],
  "owner": "team-ai-platform",
  "compatibility": {
    "targets": ["generic", "openai-codex", "claude-code"]
  },
  "dependencies": [
    {
      "kind": "instruction",
      "id": "instruction.repository-guardrails",
      "required": true
    }
  ],
  "content": {
    "entry": "content.md"
  },
  "history": [
    {
      "version": "1.0.0",
      "date": "2026-06-06",
      "notes": "Initial version."
    }
  ]
}
```

## 3. Layering

### Workspace layer

负责：

- 工作区元数据
- 支持的导出 target
- 默认 target
- 导出目录
- 本地 adapter 模块声明

### Asset layer

负责：

- 资产加载
- 资产索引
- 资产元数据读取
- 资产内容解析

### Adapter layer

负责：

- 将统一资产模型映射到目标 Agent 规范
- 封装各 Agent 的字段命名、结构差异、组织差异

### Delivery layer

负责：

- 导出到文件
- 后续接 Git / registry / package 管理

## 4. Adaptation strategy

HarnessBrew 不要求内部数据结构与某个 Agent 一一对应，而是采用：

1. 内部统一模型
2. 外部目标适配器
3. 最终生成目标格式

这使得新接入一个 Agent 时，只需要新增一个适配器，而不是重做整个资产体系。

## 5. Versioning strategy

当前版本治理范围：

- 工作区级配置版本
- 资产级语义版本
- 资产历史记录
- 资产依赖关系校验

后续可扩展：

- release channel，例如 `draft` / `stable`
- environment promotion，例如 `dev` / `staging` / `prod`
- diff report
- signed release manifest

## 6. Future plugin direction

未来建议把适配器升级为插件：

- `@harnessbrew/adapter-openai-codex`
- `@harnessbrew/adapter-claude-code`
- `@harnessbrew/adapter-generic`

这样可以把 Agent 规范变化与主仓库解耦。

在当前 MVP 阶段，HarnessBrew 已经支持通过工作区里的 `adapterModules` 加载本地 ESM adapter 模块，作为走向插件系统之前的轻量扩展机制。
