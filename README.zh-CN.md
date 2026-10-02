# HarnessBrew

[English](README.md) | 简体中文

HarnessBrew 从 Git 仓库管理 AI Agent 资产，统一解析依赖、预览变更，并向 Codex 投递 Skill、Agent、Workflow、Prompt、Instruction 和 MCP 配置。

**当前源码准备发布 1.0.0，已切换到新架构及新 CLI/SDK 契约，并删除旧后端。** 参见[破坏性变更及发布检查表](docs/releases/release-1.0.0.md)。旧 Home、Manifest、Formula 和插件不自动迁移，请使用空 Home 和新格式声明。

## 从源码运行

需要 Node.js 22+ 和 Git。

```bash
npm ci
npm run build
node dist/bin.js help
```

以下示例用 `harnessbrew` 表示构建后的命令。通过 `--home /绝对路径` 或 `HARNESSBREW_HOME` 选择 Home，默认目录为 `~/.harnessbrew`。

## 快速开始

```bash
harnessbrew tap add team/assets https://example.com/team/assets.git
harnessbrew tap trust team/assets
harnessbrew search review
harnessbrew install team/assets/review --scope project --project .
harnessbrew doctor

harnessbrew tap update team/assets
harnessbrew upgrade team/assets/review --dry-run --json
harnessbrew apply-plan <plan-id>

harnessbrew remove team/assets/review
harnessbrew cleanup
```

来源注册后默认不可信，投递前必须显式授权。remove 释放手动根要求；其他根或 Bundle 仍需要的内容与投递会保留。最后一个引用释放后，内容变为 orphan，再由 cleanup 核对库存后回收。

## 命令

| 命令 | 作用 |
| --- | --- |
| `tap add <name> <git> [--ref <ref>]` | 注册已验证的 Git 快照 |
| `tap update [name] [--ref <ref>] [--allow-rewind]` | 更新候选快照，不自动升级安装 |
| `tap trust/untrust/remove <name>`、`tap list` | 管理本机来源与信任 |
| `install <asset>`、`upgrade [asset]`、`remove <asset>` | 管理手动根要求及完整依赖闭包 |
| `link/unlink <asset>` | 添加或释放手动根的 placement |
| `bundle apply --file <path> [--update-lock]` | 精确替换一个 Bundle 绑定的要求及可移植锁 |
| `bundle detach --binding <id>` | 即使 Manifest 丢失，也能显式释放绑定 |
| `repair <asset> [--overwrite-owned]` | 修复缺失投递；显式覆盖仅限可验证的共享键/区块 |
| `cleanup`、`recover`、`doctor [asset]` | 回收孤立内容、恢复事务、检查一致性 |
| `list`、`search [text]`、`info <asset>`、`outdated` | 查询已提交状态和来源候选 |
| `adapter add <目录> --capabilities link-directory,link-file` | 授权并加载已安装插件 |
| `adapter remove <name>`、`adapter list` | 管理 Adapter，有活动 placement 时禁止移除 |
| `apply-plan <id>` | 执行宿主保存的计划，不重新规划 |

所有命令支持 `--home` 和 `--json`。变更命令支持 `--dry-run`；recover 和 apply-plan 不支持。投递参数为 `--target`（默认 openai-codex）、`--scope user|project`（默认 user）、`--project`、`--root`。已有多实例且选择不明确时必须补充范围。未知选项、重复单值选项均报错。旧别名 uninstall、relink、bundle install 已移除。

## 来源格式

```text
repository/
  tap.json
  assets/review/asset.json
  assets/review/SKILL.md
```

`tap.json`：

```json
{ "format": "harnessbrew.tap", "version": 1 }
```

`asset.json`：

```json
{
  "format": "harnessbrew.asset", "version": 1,
  "kind": "skill", "entry": "SKILL.md", "description": "Review changes",
  "dependencies": [], "conflicts": [], "targets": ["openai-codex"]
}
```

SKILL.md 的 frontmatter 必须含匹配的 `name: review` 和非空 description。依赖与冲突使用完整的 `owner/tap/asset` 坐标。资产库存拒绝符号链接和路径逃逸，文件字节、路径和权限均参与摘要。

## Bundle

```yaml
format: harnessbrew.manifest
version: 1
id: team-tools
sources:
  - name: team/assets
    git: https://example.com/team/assets.git
    ref: main
assets:
  - coordinate: team/assets/review
    placements:
      - target: openai-codex
        scope: project
        project: .
```

执行 `bundle apply --file Harnessfile.yaml`，将 `Harnessfile.yaml.lock.json` 与安装状态放在同一事务中提交。已有锁时使用精确版本；声明或 Adapter 签名变化需显式 `--update-lock`。Manifest 不能授予信任。不同 checkout 具有独立 binding，可从 list 查询。一个 Home 的同一坐标只允许一个活动版本，使用者版本冲突会直接拒绝。

## SDK 与插件

```ts
import { createHarness } from "harnessbrew";

const harness = createHarness({
  home: "/work/harness-home", cwd: "/work/project", userHome: "/home/me"
});
try {
  const preview = await harness.plan({
    kind: "asset.install", coordinate: "team/assets/review",
    placements: [{ target: "openai-codex", scope: "project", projectRoot: "/work/project" }]
  });
  await harness.apply(preview.planId);
  const installed = await harness.query({ kind: "list" });
} finally {
  await harness.close();
}
```

SDK 还提供 execute、recover、doctor。HarnessError 包含稳定 code、details、cause 和恢复提示。CLI 与 SDK 调用同一应用服务，底层 Store、锁和 Journal 不再作为公共 SDK 导出。

插件从 `harnessbrew/adapter` 引用类型，默认导出协议为 `harnessbrew.adapter/1` 的 TargetAdapter。package.json 声明示例：

```json
{
  "type": "module",
  "harnessbrew": {
    "format": "harnessbrew.adapter-package", "version": 1,
    "name": "my-adapter", "adapterVersion": "1", "entry": "index.mjs"
  }
}
```

签名覆盖插件目录；声明依赖时须包含 package-lock.json 和目录内的已安装依赖，不支持符号链接，推荐使用已打包的插件。第三方只允许链接能力。新插件 add 预览只读声明；授权执行先验证签名和导出，再导入已核验的副本。插件以宿主代码运行，不是进程沙箱。

## 预览、恢复与 JSON

预览可以写 Home 旁的隔离缓存，不初始化新 Home、不授予信任、不改锁文件和 Target。计划与本机 Home 绑定；revision、目标、Manifest 或插件改变后拒绝应用，不接受任意操作 JSON。

Home 使用 CURRENT 和 revisions/ 发布完整状态，内容存于 content/。事务将恢复证据写入 transaction.json。待恢复事务阻止普通查询和预览；doctor 仍可输出不完整诊断，recover 核对归属后再恢复或清理。孤立内容经过可验证的隔离目录回收，删除中断后可以继续。

修改过的链接和整文件即使指定 `--overwrite-owned` 也会保留，因为仅凭路径无法证明持续归属；共享键/区块须能识别归属，并显式授权覆盖。损坏内容不会被静默重建。

JSON stdout 只输出一个 `harnessbrew.result` version 1 对象，包含 ok、command、mode、result 或 error、diagnostics。退出码：0 成功，1 业务失败或诊断不健康，2 参数/格式错误，3 需要恢复或恢复冲突，4 非预期故障。

## 开发验证

```bash
npm run check:all
```

包含构建、快速测试、共用一个候选包的打包测试，以及已迁入新业务服务的历史回归。旧后端专用测试已清理，历史回归通过新业务服务验证。runtime preflight 的自动测试使用模拟 runtime，真实 Codex 验收是单独的发布检查。

详见[架构决策](docs/design/refactor-architecture.zh-CN.md)、[契约](docs/design/refactor-contracts.zh-CN.md)和[阶段 6 实施记录](docs/design/phase6-implementation.zh-CN.md)。

## 许可证

MIT。
