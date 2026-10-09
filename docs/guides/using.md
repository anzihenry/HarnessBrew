---
title: 使用与命令
status: current
owner: project-maintainers
updated: 2026-10-09
---

# 使用与命令

[English](using.en.md)

## 命令

| 命令 | 作用 |
| --- | --- |
| `tap add <name> <git> [--ref <ref>]` | 注册已验证的 Git 快照 |
| `tap update [name] [--ref <ref>] [--default-branch] [--allow-rewind]` | 更新候选快照，不自动升级安装 |
| `tap trust/untrust/remove <name>`、`tap list` | 管理本机来源与信任 |
| `install <asset>`、`upgrade [asset]`、`remove <asset>` | 管理手动根要求及完整依赖闭包 |
| `link/unlink <asset>` | 添加或释放手动根的 placement |
| `bundle apply --file <path> [--update-lock]` | 精确替换一个 Bundle 绑定的要求及可移植锁 |
| `bundle detach --binding <id>` | 即使 Manifest 丢失，也能显式释放绑定 |
| `repair <asset> [--restore-content] [--overwrite-owned]`、`repair --all` | 恢复精确安装内容和缺失投递；修改内容先隔离，目标覆盖仅限共享键/区块 |
| `cleanup`、`recover`、`doctor [asset]` | 回收孤立内容、恢复事务、检查一致性 |
| `list`、`search [text]`、`info <asset>`、`outdated` | 查询已提交状态和来源候选 |
| `adapter add <目录> --capabilities link-directory,link-file` | 授权并加载已安装插件 |
| `adapter remove <name>`、`adapter list` | 管理 Adapter，有活动 placement 时禁止移除 |
| `apply-plan <id>` | 执行宿主保存的计划，不重新规划 |

所有命令支持 `--home` 和 `--json`。变更命令支持 `--dry-run`；recover、apply-plan、apply-maintenance 和 recover-maintenance 不支持。maintenance 必须使用 --dry-run。投递参数为 `--target`（默认 openai-codex）、`--scope user|project`（默认 user）、`--project`、`--root`。已有多实例且选择不明确时必须补充范围。未知选项、重复单值选项均报错。旧别名 uninstall、relink、bundle install 已移除。

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

## 全量修复与来源跟踪

`repair --all` 在一个事务中按摘要去重修复全部活动资产，不能与资产参数或 placement 选择一起使用；修改内容仍须 `--restore-content`。

`tap update [name] --default-branch` 清除固定 ref 并跟随远端 HEAD，与 `--ref` 互斥。固定 ref 保存为完整分支或标签；切换为非快进仍须 `--allow-rewind`。策略和快照共同提交，预览不修改策略。

维护命令及全局取消、期限和进度参数见[维护指南](maintenance.md)。
