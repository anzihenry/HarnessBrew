---
title: 统一状态与事务重构
status: completed
owner: project-maintainers
updated: 2026-10-09
---

# 统一状态与事务重构

[English](README.en.md)

## 目标、范围与完成条件

将 Receipt/Cellar 旧后端替换为领域模型、统一 Resolver/Planner、不可变状态与持久 Journal，使 CLI/SDK 共用应用入口。范围包含阶段 1 设计至阶段 7 旧实现清理；成功条件是新链路覆盖安装、Bundle、所有权、诊断、恢复及历史回归，旧模块不再进入包。

## 历史结果

2026-10-03 的阶段 7 记录说明本地实现及验收完成：删除 21 个 core 模块及 15 个旧专用测试文件；锁、崩溃、共享所有权和 A02/A03/A05 回归迁入新服务。快速测试 142、打包 19、回归 3 通过，macOS/Linux gate 及真实 Codex 0.159.2 四探针通过。

历史开发候选 1.0.0 基线 ea005e0d76a0e4dcc873fe51cfe8ade53cdac960，SHA-256 1ddd6d54db75a18c40bb35e5c95c2479a8b0f8c7729d01d885df8b357b179768，source.dirty=true。原报告只在忽略的 release-artifacts/phase7/，仓库内没有完整原始报告，不能当作干净发布候选或正式发布证据。首次沙箱探针失败未确定根因，联网重试通过；不混算。

## 当前依据与验证

有效规则已整理到[架构](../../../engineering/architecture.md)、[接口契约](../../../engineering/contracts.md)、[锁协议](../../../engineering/file-locks.md)；操作见[指南](../../../guides/README.md)。[1.0.0 记录](../../../releases/1.0.0/README.md)保留发布边界。

专题完成表示历史重构目标完成，不表示旧候选可发布。历史设计、任务编号和逐阶段测试计数已合并，独立维护状态只在本入口。局部技术细节以当前源代码为准。后续 A/B/C 独立专题见[索引](../../README.md)。本次文档迁移检查及独立评审见[迁移验证](../../process/documentation-standard/validation.md)。
