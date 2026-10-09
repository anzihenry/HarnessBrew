---
title: 1.0.0 版本记录
status: planned
owner: project-maintainers
updated: 2026-10-09
---

# 1.0.0 版本记录

[English](README.en.md)

1.0 是统一状态与事务的破坏性基线，公开入口切换为 createHarness 和 harnessbrew/adapter，旧 CLI 别名/Receipt/Cellar 移除，声明要求 format/version。

已记录的验证为 dirty 本地开发包，不满足干净候选发布要求；原始报告未归档在仓库。来源和局限见[重构专题](../../initiatives/refactor/unified-state-transactions/README.md)和[内容专题](../../initiatives/feature/content-lifecycle/README.md)。因此本记录维持 planned，不宣称已发布。

旧数据先备份，选择空 Home，改写来源/资产/Bundle/插件声明，显式信任与授权，预览后应用并检查 doctor。旧目标不会自动归新 Home 接管。正式发布须按[发布指南](../../guides/releasing.md)形成干净、同摘要且时效有效的候选证据。
