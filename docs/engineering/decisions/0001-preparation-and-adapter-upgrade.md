---
title: 0001：准备边界与 Adapter 升级授权
status: current
owner: project-maintainers
updated: 2026-10-09
---

# 0001：准备边界与 Adapter 升级授权

[English](0001-preparation-and-adapter-upgrade.en.md)

决策日期：2026-10-06；本记录于迁移时按已实现的 A/B/C 结果复核。范围为锁外准备、候选授权和格式演进。关联[架构](../architecture.md)、[升级契约](../adapter-upgrades.md)和[保留协议](../maintenance-retention.md)。

## 背景与备选

Git/插件/内容准备耗时长，持事务锁会阻塞查询和无关工作。完整候选升级必须执行插件 plan，纯静态检查无法提供完整差异。备选包括持锁完成准备、静态检查即授权、先更新注册再写目标；这些方案分别扩大争用、隐含代码执行授权或产生部分成功。

## 决策

短锁读取一致快照，锁外准备，提交按既有锁序恢复并复验全部证据。漂移返回 PLAN_STALE，不自动重规划。execute 先恢复；plan/query 遇 pending Journal 拒绝；apply 不重新准备；首次 plan 不初始化 Home。

静态 inspect 与摘要/能力授权分离，授权后才加载候选生成准确计划。手动及全部受影响 Bundle 的注册、投放和 lock 统一提交，资产 pins 不变。protocol、version 与 signature 分离，签名规则版本化，不因 version 相同忽略摘要。

准备数据包含请求、revision、物理 Home、固定来源/候选、外部指纹和暂存引用，不序列化回调和实例。普通预览 v2、升级 v3，持久 v1 结构不隐式添加字段；格式不兼容明确拒绝。租约先于缓存访问，持久引用保护创建者退出后的输入。

## 后果与验证

竞争导致显式重试；staging 可能被消费，失效时重新预览。插件仍具宿主进程权限。租约/引用和保守 GC 增加维护复杂度，混合旧程序时不运行回收。兼容结构不等于兼容行为，回退须保留包及一致备份。

验证见[准备专题](../../initiatives/refactor/preparation-boundary/README.md)、[升级专题](../../initiatives/feature/adapter-upgrade/README.md)及[版本证据](../../releases/README.md)。目前没有替代决策；今后改变须新增编号记录并更新本记录状态。
