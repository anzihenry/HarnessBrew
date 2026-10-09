---
title: 1.1.0 版本记录
status: verified
owner: project-maintainers
updated: 2026-10-09
---

# 1.1.0 版本记录

[English](README.en.md)

A 批次候选于 2026-10-07 本地验收通过，未正式发布。Git、插件与内容准备移到事务写锁外，提交保留完整复验、目标锁与持久 Journal；漂移拒绝并要求重新预览。

普通保存计划切换 v2，v1 须重建；Home/Journal/ChangePlan/Bundle/CLI 各 v1。兼容结论基于内容生命周期完成后的基线，缺少库存字段的实验 Home 不迁移。缓存租约和持久引用包含历史根；当时 GC 延至后续 C，现在用当前指南。

回退前停止工作并恢复 pending Journal，保留一致 Home、目标和锁备份。旧公开 0.7.1 不作为 v1 Home 回退版本。详细候选摘要、构建源码、失败重试和验收见[验证记录](validation.md)。正式发布必须重新满足[受保护流程](../../guides/releasing.md)，历史报告不证明当前时效或生产 provenance。
