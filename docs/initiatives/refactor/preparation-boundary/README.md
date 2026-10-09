---
title: 锁外准备与边界整理
status: completed
owner: project-maintainers
updated: 2026-10-09
---

# 锁外准备与边界整理

[English](README.en.md)

## 目标、范围与完成条件

A01–A12 整理应用用例/端口，统一锁外 Git、插件和内容准备，保留提交复验、锁序和恢复不变量。完成条件包含漂移、首次初始化、别名、持久引用、多进程崩溃与同候选跨平台验收。

## 历史结果与证据

A 批次交付于 1.1.0，fast 205、packaged 19、regressions 3、Linux/macOS gate、真实四探针通过。候选身份与失败历史的唯一详细记录见[1.1.0 验收](../../../releases/1.1.0/validation.md)。

[基准对比](benchmark.md)保留六组单次来源规模测量；原始 JSON 在 evidence，不是大量已安装 placement 或 p95 保证。[基准方法](../../../guides/benchmarking.md)说明可重复操作。

现有[准备竞争](../../../../tests/preparation-concurrency.test.ts)、[漂移](../../../../tests/preparation-freshness.test.ts)、[崩溃](../../../../tests/preparation-crash.test.ts)、[租约](../../../../tests/cache-leases.test.ts)和[准备格式](../../../../tests/prepared-change.test.ts)验证不变量；未记录写入仍保留日志报冲突。

## 当前依据与收口

历史 A 目标完成，当前维护 GC 已由后续 C 批次交付。有效[架构](../../../engineering/architecture.md)、[锁/租约](../../../engineering/file-locks.md)及[ADR](../../../engineering/decisions/0001-preparation-and-adapter-upgrade.md)持续维护。本入口维护历史任务状态，跨批里程碑见[交付历史](../../../planning/delivery-history.md)。文档迁移独立检查见[验证](../../process/documentation-standard/validation.md)。
