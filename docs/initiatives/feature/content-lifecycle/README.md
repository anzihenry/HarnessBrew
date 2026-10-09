---
title: 内容库存与精确修复交付
status: completed
owner: project-maintainers
updated: 2026-10-09
---

# 内容库存与精确修复交付

[English](README.en.md)

## 目标与范围

登记摘要库存，安全回收无引用内容，从已安装 commit 精确修复内容及投放；修改内容隔离保留。完成条件为共享摘要、来源撤信、预览漂移、失败回滚和 CLI/SDK 一致性验证。

## 实施与历史验证

2026-10-05 的实施记录：契约 9ad0c50、库存 4e729d7、回收 7f51ee6、恢复准备 15f19a8、事务 d252e45、CLI/SDK 15488a1。验收修复 Catalog 多快照排序及共享摘要来源准备。

本地开发候选 1.0.0，基线 15488a1b1155ac8b8cc60f53391a5446d2583e42，dirty=true，SHA-256 b92dd902bb9a04a689e4d1185804a2a27097be3dccd4e9ad4ec732d2b3a9eddb。fast 162、packaged 19、regressions 3、Linux/macOS 五场景及 Codex 0.160.0 四探针重试通过。首次 agent/MCP 失败根因未确定；报告只在忽略的本地产物目录，非干净发布证据。

覆盖连续升级保留旧摘要、共享引用、缺失/修改/未知内容、精确 commit、缓存不可用、隔离与状态写前后 SIGKILL、外部修改冲突和完整隔离原件保留。未发布。

## 完成与后续依据

历史目标完成；当前[内容契约](../../../engineering/content-lifecycle.md)和[恢复指南](../../../guides/recovery.md)维护现状。修复全部资产及跟踪默认分支行为见[使用指南](../../../guides/using.md)。本入口是历史状态的唯一维护位置；局部成功不证明全 Home 健康，旧实验 Home 不自动迁移。迁移评审见[验证记录](../../process/documentation-standard/validation.md)。
