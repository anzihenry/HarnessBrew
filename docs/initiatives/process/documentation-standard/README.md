---
title: 文档规范与全仓库迁移
status: completed
owner: project-maintainers
updated: 2026-10-09
---

# 文档规范与全仓库迁移

[English](README.en.md)

## 目标、范围与完成条件

将项目全部文档迁入已确认的全生命周期规范，中文主文件默认提供英文；抛弃旧目录、文件名和重复历史计划，无旧路径兼容层。负责人 project-maintainers 为仓库维护者团队；本入口是专题任务状态的唯一来源。

范围包括根 README/CHANGELOG、所有维护中文档、A/B/C 原始候选证据、基准数据、自动检查及 CI。完成条件为旧材料有明确处理结果、当前内容和双语一致、证据字节保留、全仓库结构/测试通过、独立评审没有阻断问题。完成结论以最终独立评审和默认检查为准，未通过不得交付。

## 交付与删除规则

| 原内容 | 处理 |
| --- | --- |
| README.zh-CN / 英文 README | 中文改为 README，英文 .en，详细用法拆 guides |
| architecture / design 中的当前契约 | engineering 架构、接口、内容、锁、维护、操作和升级契约，补英文 |
| refactor 和 phase2–7 | 合并为统一状态事务专题，保留目标、结果、候选局限和测试引用 |
| 内容实施记录 / A/B/C 任务 | 合并专题结果及 planning 交付里程碑，删除过时估计/拟议接口/重复勾选 |
| benchmark 说明与 JSON | 方法进 guides，结果/原始字节进准备专题 |
| release-runbook | guides/releasing，中英一致 |
| 0.x 重复发布执行计划 | 删除；全部原始版本变更条目继续保留于双语 CHANGELOG |
| 1.x 版本 / A/B/C 验收 | 版本目录与真实状态，详细验收中英配对，原报告逐字迁移 |
| 旧草案十文件检查/评审 | 删除失效脚本和摘要，由全仓库检查与本次评审替代 |

逐份源路径、摘要、删除/合并理由和目标见[迁移清单](evidence/migration-inventory.json)，它是审计证据，不是旧路径重定向。历史原始报告保留原始语言，由双语验证说明；旧变更语义保留历史上下文，不冒充现状。

## 当前依据

[规范与配置](../../../documentation.md)、[文档地图](../../../README.md)、[开发交付检查](../../../guides/development.md)、[验证记录](validation.md)。research/product/UX design 无独立资料，不创建空目录；状态格式按文档类型统一。

## 任务与进度

| 工作 | 状态 | 依据 |
| --- | --- | --- |
| 通用规范与项目配置 | 已整理 | 1.0 规范；团队负责人、专题任务源、90 天复核约定 |
| 全部历史材料处理 | 已整理 | 迁移清单，旧目录与中文后缀删除，无兼容文件 |
| 当前契约/指南/双语/导航 | 已整理 | 新目录，修正版本/GC/预览保护和 dry-run 例外 |
| 全仓库自动门槛及测试 | 通过 | check:docs/test:docs，npm check 与 CI documentation job |
| 独立内容/双语/证据评审 | 见验证记录 | 结论、读取范围、修正和最终摘要以 validation 为准 |

本次未正式发布、推送或修改远端仓库设置；CI 代码门槛已接入，外部 required status checks 由管理员配置并在合入时确认。这不改变本次本地文档验收范围。
