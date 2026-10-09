---
title: 跨专题交付历史
status: current
owner: project-maintainers
updated: 2026-10-09
---

# 跨专题交付历史

[English](delivery-history.en.md)

本文件记录已完成的里程碑和依赖，不作为当前待办清单。各专题入口维护自己的任务状态，发布记录维护候选和发布状态。

| 里程碑 | 依赖与结果 | 专题 |
| --- | --- | --- |
| 统一状态与事务，1.0 基线 | 领域→来源/Resolver→Planner/Adapter→Executor/Journal→应用入口→旧实现清理；本地 dirty 候选验证，不代表正式发布 | [重构](../initiatives/refactor/unified-state-transactions/README.md) |
| 内容生命周期 | 库存→回收→精确恢复→隔离事务→诊断/SDK；纳入后续 A 基线 | [内容](../initiatives/feature/content-lifecycle/README.md) |
| A：边界与锁外准备，1.1.0 | 建立契约和基准，完成租约、锁外准备和提交复验 | [准备](../initiatives/refactor/preparation-boundary/README.md) |
| B：原子 Adapter 升级，1.2.0 | 依赖 A；先手动闭环再联合 Bundle，保留严格格式与回退证据 | [升级](../initiatives/feature/adapter-upgrade/README.md) |
| C：维护与操作控制，1.3.0 | 依赖 A 租约/B 升级；保护有效输入、安全取消与排空 | [维护](../initiatives/feature/maintenance-controls/README.md) |

旧计划中的工程日估计和拟议接口已失去执行意义，删除；32 项逐任务完成记录合并为上述里程碑及专题结果，不重复维护勾选状态。本次[文档迁移](../initiatives/process/documentation-standard/README.md)是新的流程专题，完成条件不等于历史产品发布。

[版本索引](../releases/README.md)记录可追溯的 1.x 候选，早期变更保留在[CHANGELOG](../../CHANGELOG.md)。
