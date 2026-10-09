---
title: 预览、诊断与内容恢复
status: current
owner: project-maintainers
updated: 2026-10-09
---

# 预览、诊断与内容恢复

[English](recovery.en.md)

## 预览、恢复与 JSON

预览可以写 Home 旁的隔离缓存，不初始化新 Home、不授予信任、不改锁文件和 Target。计划与本机 Home 绑定；revision、目标、Manifest 或插件改变后拒绝应用，不接受任意操作 JSON。

Git/来源准备、插件准备和内容 staging 在事务写锁外进行，提交前重新核验准备证据。并发变更导致 `PLAN_STALE` 时，重新执行原命令并加 `--dry-run`，再应用新 plan ID；不会自动重规划。旧 saved-plan v1 预览须重新生成 v2，Home/Journal 和公开 JSON 格式仍为 v1。首次预览不初始化 Home，其他进程的初始化可能使其失效。

进程租约及持久预览引用保护缓存，也覆盖被引用的历史缓存目录；同一物理 Home 的路径别名共享保护。不要手动删除正在使用的缓存；缓存维护须通过维护预览和显式执行。应用计划可能消费暂存内容，重试时若暂存已不可用，须重新预览。执行与恢复边界见[架构说明](../engineering/architecture.md)。

Home 使用 CURRENT 和 revisions/ 发布完整状态，内容存于 content/。事务将恢复证据写入 transaction.json。待恢复事务阻止普通查询和预览；doctor 仍可输出不完整诊断，recover 核对归属后再恢复或清理。孤立内容经过可验证的隔离目录回收，删除中断后可以继续。

修改过的链接和整文件即使指定 `--overwrite-owned` 也会保留，因为仅凭路径无法证明持续归属；共享键/区块须能识别归属，并显式授权覆盖。损坏内容不会被静默重建。

JSON stdout 只输出一个 `harnessbrew.result` version 1 对象，包含 ok、command、mode、result 或 error、diagnostics。退出码：0 成功，1 业务失败或诊断不健康，2 参数/格式错误，3 需要恢复或恢复冲突，4 非预期故障。

## 内容回收与恢复

Home 的 `contents` 按摘要登记受管清单和精确来源，活动安装记录决定引用。升级后的旧摘要仍在库存中；`cleanup` 回收无活动引用且校验通过的内容。缺失目录可清理失效记录，修改内容和未知目录保留并报告。历史 revisions、来源缓存和修复隔离副本不由 cleanup 删除。

```bash
harnessbrew cleanup --dry-run --json
harnessbrew apply-plan <plan-id>
harnessbrew doctor
harnessbrew repair team/assets/review --dry-run --json
# 已修改内容需要显式授权；原内容将被保留
harnessbrew repair team/assets/review --restore-content
```

repair 从已安装 commit 恢复，不升级；缓存丢失或损坏时尝试重新获取精确 commit，要求来源仍可信。内容准备在写事务外进行，执行时重新核验状态与内容。`--restore-content` 与 `--overwrite-owned` 分别授权内容隔离恢复和共享目标键/区块覆盖。存在无法安全检查的特殊文件时，停止并要求检查，不强制递归删除。

预览及执行结果的 `contentChanges` 提供摘要、动作、文件字节数、受影响资产和恢复 commit；执行后还返回隔离路径。共享摘要只恢复一次，并检查相关投放。SDK 对应参数为 `restoreContent: true`；`query({kind: "list"})` 包含 `contents` 和 `quarantines`。

Doctor 区分 CONTENT_MISSING、CONTENT_MODIFIED、CONTENT_UNREFERENCED、CONTENT_UNREGISTERED 和 CONTENT_QUARANTINED。info/warning 提示不会单独导致不健康；error 或检查不完整会。隔离副本由用户检查后手动处理，cleanup 不删除它们。

当前 Home 必需字段包含 `contents` 和 `quarantines`，不自动迁移此前缺少必需字段的实验 Home。请使用新 Home；旧目录保留用于人工检查。

完整退出码及取消语义见[操作控制契约](../engineering/operation-control.md)。
