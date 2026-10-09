---
title: 维护保留与恢复契约
status: current
owner: project-maintainers
updated: 2026-10-09
---

# 维护保留与恢复契约

[English](maintenance-retention.en.md)

适用版本：1.3.0。实现见 [retention.ts](../../src/application/retention.ts)、[maintenance.ts](../../src/application/maintenance.ts) 和[维护执行](../../src/application/maintenance-execution.ts)。

## 判定与保护

维护处理宿主缓存与审计 revisions，区别于内容 cleanup。默认 TTL 30 天、每类最新 10 项、报告预算 1 GiB。限制为非负安全整数；预算不能提前删除受保护对象。

归属未知、时间异常、大小未知或引用解析失败为 unknown；CURRENT、恢复证据、有效计划和活跃租约为 protected；TTL 或最新数量内受保护；其余已证明归属、过期、无引用对象才 deletable。报告包含总量、保留、保护和超预算字节，未知大小不保证总量准确。

保留全部状态 catalog snapshots、离线 repair 来源、注册插件、用户 quarantine 和 Journal before/next 及步骤证据。路径重叠保护祖先，不能删除上层绕过后代引用。活 PID、权限不足或 PID 重用保护整个缓存，不按 TTL 抢占。跨缓存根引用、损坏保护记录、未知文件、symlink 和 bare Git repositories 保守保留。

## 保存计划与预览

普通/升级计划自文件最后写入起 30 天后 apply 返回 PLAN_STALE，reason=expired；删除后的 ID 返回 PLAN_NOT_FOUND。短 TTL 不能删除有效计划，过期引用在回收事务核验并退休前仍保护资源。planMaintenance 保存精确时点、策略、路径身份、摘要、大小和保护原因；apply 不自动纳入新候选。

枚举 plans、prepared、restores、source snapshots、plugin signatures、revisions 和维护计划。prepared/restore 使用 .owner.json 证明归属；来源和插件静态验证声明及完整库存，不 import 插件。未核实未知目录可报告 0 字节，不能据此推断实际磁盘量。Home Journal 待恢复时拒绝维护预览/执行。

## 执行与恢复

applyMaintenance 要求已初始化 Home，按 Home → cache leases guard 复验 revision、引用和文件内容/设备/inode。活跃租约立即拒绝，无目标锁。只退休同缓存根、过期且完整校验的 references；跨根保留。

cache/maintenance/transaction.json 先 fsync 证据，再 rename 到隔离目录并 fsync 原/新目录，重验后记录 deleting 并逐项核验删除。已删条目允许缺失，目录仅为空时 rmdir。revisions 就地隔离，避免跨设备 rename。

恢复只处理已记录对象；身份变化、新文件和改写数据返回 RECOVERY_CONFLICT 并保留日志和剩余内容。新消费者遇维护待恢复日志返回 RECOVERY_REQUIRED，调用 recover-maintenance。

CURRENT、有效计划 baseRevision 和恢复 revisions 永远优先保留；维护预览文件至少保护 30 天，此后按 TTL 和最新数量判断回收，执行仍复核输入；这不等同于普通保存计划的 apply 过期规则。revisions 不是一致回退备份，quarantine 不因 TTL 或预算自动删除；受保护历史可能无限超过预算。

步骤见[维护指南](../guides/maintenance.md)，历史验证见[1.3.0 验收](../releases/1.3.0/validation.md)。
