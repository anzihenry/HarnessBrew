---
title: Adapter 原子升级交付
status: completed
owner: project-maintainers
updated: 2026-10-09
---

# Adapter 原子升级交付

[English](README.en.md)

## 目标、范围与完成条件

B01–B10 实现静态检查、摘要/能力授权、固定资产规划以及手动与全部 Bundle checkout 的统一事务。完成条件为注册、投放和每个 lock 一致，旧格式读取、反向第三方升级、崩溃及一致备份回退有证据。

## 历史结果与风险

1.2.0 候选 fast 243、packaged 19、regressions 3、Linux/macOS gate 和真实 Codex 四探针通过；实际保留的 1.1.0 包建立安装，1.2.0 联合升级后恢复一致备份，旧包 doctor 通过。[版本验收](../../../releases/1.2.0/validation.md)保留双包摘要和演练结果。

原 B08 在 A 基线 384caa0 与 v1 schema 逐字比较，确认 Home/Journal/Bundle/ChangePlan 不扩展字段；升级 saved-plan v3 保存新增授权和 lock 集合。最小 A v2 fixture 仅验证解析，不伪装任意主机可执行计划。实际兼容范围见[当前契约](../../../engineering/adapter-upgrades.md)。

## 完成与当前依据

历史目标完成，未因此宣称正式发布。运行步骤见[升级指南](../../../guides/adapter-upgrades.md)，结构兼容不代表旧插件可运行新注册；修改整文件/链接不强制覆盖，未持久记录写入可能要求人工恢复。本入口维护历史状态，详细验收引用版本，不重复证据。迁移评审见[验证](../../process/documentation-standard/validation.md)。
