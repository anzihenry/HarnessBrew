---
title: 1.2.0 版本记录
status: verified
owner: project-maintainers
updated: 2026-10-09
---

# 1.2.0 版本记录

[English](README.en.md)

B 批次候选于 2026-10-07 本地验收通过，未正式发布。静态检查不 import，显式摘要/能力授权后规划，单事务更新注册、目标和全部 Bundle lock，资产 pins 不变。

普通计划 v2，升级 v3；Home/Journal/Bundle/CLI 各 v1。内置 signature 改为运行时闭包与生产锁，已有注册须显式升级。结构可读不代表旧 Adapter 可执行新注册。

保留旧包及一致 Home/目标/全部 lock 备份，仅降级二进制不是回退。验收实际从 A 1.1.0 安装升级到 B 并恢复备份，记录在[验证](validation.md)，仅对应临时测试 Home。升级用法见[指南](../../guides/adapter-upgrades.md)，兼容性见[契约](../../engineering/adapter-upgrades.md)。正式发布另走[受保护流程](../../guides/releasing.md)。
