---
title: 全仓库文档迁移验证
status: completed
owner: project-maintainers
updated: 2026-10-09
---

# 全仓库文档迁移验证

[English](validation.en.md)

## 交付对象与身份

交付对象为全部维护文档迁移、全仓库检查工具及 CI 接入，基线为 5cf66d7cf12673f7c3a6a433d73f84fb4766db49，负责人 project-maintainers，主 AI 编写。未创建 PR/提交，最终工作区身份见[结构报告](evidence/documentation-check.json)及[独立评审](evidence/independent-review.json)。

## 影响清单

| 领域 | 结论 | 原因与证据 |
| --- | --- | --- |
| research/product/UX design | 不适用 | 当前无独立材料，不编造产品规则或研究结果；目录职责见规范 |
| engineering | 已更新 | 当前架构/契约、锁/租约、内容、升级、维护、操作与 ADR 均中英复核 |
| guides | 已更新 | 使用、SDK、升级、恢复、维护、开发、发布、基准拆分，完整链接与示例 |
| planning/initiatives | 已更新 | 历史阶段/任务合并，跨专题里程碑与专题唯一状态源分离 |
| releases/evidence | 已更新 | 1.x 真实候选状态和中英验收，原始报告与基准迁移摘要一致 |
| 根入口/CHANGELOG/索引 | 已更新 | 中文主文件、英文配对，CHANGELOG 原条目全部保留并翻译 |
| 工具与 CI | 已更新 | check-docs 脚本、负例测试、package check、CI job，相关身份须独立批准 |

链接从[文档地图](../../../README.md)进入。各项源文件处理见[清单](evidence/migration-inventory.json)，逐字保留的证据在结构检查中自动对比 SHA-256。

## 自动检查与测试

```sh
npm run check:docs -- --structure-only
npm run test:docs
npm run check:architecture
npm run build
npm run test:fast
npm run release:verify
npm run check:docs -- --report docs/initiatives/process/documentation-standard/evidence/documentation-check.json
```

默认 check:docs 除结构还验证独立结论及所有维护文档、源码/工具摘要，修改后旧结论拒绝。structure-only 只供作者准备，不作为交付通过。test:docs 在临时仓库验证非法日期/状态、缺翻译、断文件/锚点、跨语言引用、索引不一致、缺失/过期评审以及实现改变均拒绝。

产品运行时行为未变，构建/快速测试与版本校验验证配置和公开 CLI 示例可用；不重跑历史候选跨平台/真实 Codex，不以文档迁移宣称新包验收。实际测试结果见[测试摘要](evidence/test-summary.json)。example.com URL 是占位，不能伪称已联网安装；来源/SDK 格式示例沿用现有契约及相关测试。

## 独立评审与修正

评审者为 /root/documentation_review，独立 AI，未编写或修改文件，独立读取现有代码、原文快照、迁移后文档、自动脚本、测试和证据。按规范清单评估内容、范围、双语、完整迁移及可执行门槛。读取范围、发现、最终结论和摘要保存在[原始评审结论](evidence/independent-review.json)，其结果为准。

首轮发现并修正：维护预览的30天保留保护不等于普通计划 apply 过期；四项 dry-run 例外；英文恢复命令示例；英文架构根入口同语言链接。另修正 SDK 的 import/导出检查顺序，并将 scripts 全树及依赖/构建配置纳入批准身份，测试发布工具变化也拒绝旧评审。最终复核覆盖这些修改。

## 范围与遗留边界

旧阶段记录/重复发布计划已删除或合并，无兼容行为。候选历史证据不证明正式发布或未来发布时效。CI 门槛已写入代码，远端 branch protection/required status checks 本次未配置，必须由维护者在正式合入时确认；其不影响本地结构迁移，但不能宣称远端保护启用。相关修改必须重新检查及独立评审，正式提交时绑定交付提交。

本记录仅评价当前迁移，不追认旧历史交付曾满足新规范；历史专题 completed 根据已有实施/候选证据，迁移后的文档质量由本次独立评审覆盖。
