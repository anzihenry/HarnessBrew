---
title: 1.3.0 版本记录
status: verified
owner: project-maintainers
updated: 2026-10-09
---

# 1.3.0 版本记录

[English](README.en.md)

C 批次候选于 2026-10-08 本地验收通过，未正式发布。加入保守维护回收、取消、期限、进度与 close 排空。候选产物和最终源码身份见[验收记录](validation.md)。

默认 TTL 30 天、每类保留 10、报告预算 1 GiB；预算不能覆盖有效计划、活跃租约、CURRENT、注册插件、来源和 quarantine 保护。未知归属/跨根引用/历史/bare Git 保守保留，容量不保证收敛。保存计划 30 天过期后重新生成，revisions 不是备份。

SDK 独立选项 signal/timeoutMs/onProgress，CLI 对应期限、stderr 进度和信号。提交前安全取消回滚，提交后仍返回 committed；恢复/回滚可超期限，close 等待而不隐式取消。

普通 v2、升级 v3、Home/Journal/Bundle v1 保持，维护计划/日志独立；内置签名变化仍须授权升级。完整限制见[维护](../../engineering/maintenance-retention.md)和[操作契约](../../engineering/operation-control.md)。历史候选证据不能保证未来正式发布时仍满足时效，发布必须按[指南](../../guides/releasing.md)重新生成证据。
