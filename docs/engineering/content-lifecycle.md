---
title: 内容库存与精确修复
status: current
owner: project-maintainers
updated: 2026-10-09
---

# 内容库存与精确修复

[English](content-lifecycle.en.md)

适用版本：1.3.0。实现见 [content.ts](../../src/application/content.ts)、[restore.ts](../../src/application/restore.ts) 和[内容领域模型](../../src/domain/content.ts)。

内容以摘要为主键，库存登记文件清单与精确来源（坐标、commit、快照）；活动安装推导引用，升级保留旧摘要。cleanup 只回收登记且无活动引用、执行时核验通过的内容。缺失目录可清理记录，修改内容和未登记目录保留报告。缓存、revisions 和用户 quarantine 不属于 cleanup。

repair 固定已安装摘要和 commit，不升级或重新求解依赖。缺失内容可恢复；修改内容必须 restoreContent/--restore-content，先隔离原目录再恢复，提交后保留原件。overwriteOwned/--overwrite-owned 仅授权可识别共享键或区块，不接管修改过的整文件/链接。

来源须可信；优先验证缓存，必要时获取精确 commit，不能退回最新。准备在写事务外，事务内复验 revision、信任、内容与目标；隔离、发布、目标修复和状态共用 Journal。提交前失败恢复旧内容，提交后保留正确内容和隔离证据；外部修改或无法安全检查的特殊文件保留并报冲突。

单资产修复只检查所选资产，共享摘要扩展到相关投放；局部成功不等于整个 Home 健康。repair --all 按摘要去重在一个事务中修复所有活动资产，不与 coordinate/placement 混用，任一恢复无法验证则不发布。

结果 contentChanges 提供摘要、动作、文件字节数、受影响资产、恢复 commit 和执行后的隔离路径；list 包含 contents/quarantines。Doctor 区分缺失、修改、未引用、未登记、已隔离内容，warning/info 单独不会判不健康，error 或检查不完整会。缺少必需库存字段的实验 Home 被拒绝，不从未知目录推断所有权。

操作步骤见[恢复指南](../guides/recovery.md)，历史交付见[内容专题](../initiatives/feature/content-lifecycle/README.md)。
