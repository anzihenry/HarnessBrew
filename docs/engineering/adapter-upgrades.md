---
title: Adapter 升级与兼容契约
status: current
owner: project-maintainers
updated: 2026-10-09
---

# Adapter 升级与兼容契约

[English](adapter-upgrades.en.md)

适用版本：1.3.0。实现见[升级用例](../../src/application/use-cases/adapter-upgrade.ts)、[规划器](../../src/planning/plan.ts)和[执行器](../../src/execution/adapter-upgrade.ts)。

静态 inspect 不 import，不产生 planId，返回摘要、声明、签名覆盖及受影响资产/bindings。确切 signature 和能力授权后才加载候选并规划，dry-run 不自动授予执行代码权限。第三方只能 link-file/link-directory；静态 requiredCapabilities 未知时为 null，授权后核验导出。

固定已安装 commit、内容摘要和依赖，不升级资产，只重新投放所选 Adapter。候选变化 ADAPTER_CHANGED；缺少全部受影响 checkout Manifest 返回 LOCK_MISMATCH/missingBindings。核对 ID、物理目录、声明摘要、原 lock 和闭包；重复/额外输入拒绝。

旧注册→新注册、所有目标和全部受影响 lock 在一个 v1 Journal 提交。锁只替换目标 Adapter 签名，pins、依赖、sources、roots、manifestDigest 不变。恢复依据旧状态和 before/after 图像，不运行旧插件。外部修改保留证据报冲突，未记录写入不保证自动回滚。

普通 saved-plan v2、升级 v3，Home/Journal/Manifest/Bundle lock/ChangePlan/CLI result 各 v1。旧 v1 预览拒绝并重新生成；A 读者拒绝 v3。升级授权和 lock 集合在保存计划外层，不扩展严格 ChangePlan v1 字段。

内置 signature 规则 builtin-closure/1 覆盖 emitted runtime 闭包和生产依赖锁，排除文档/source map/时间戳；实现声明 version 相同也须显式升级。第三方签名覆盖库存、依赖与 lock。身份验证不隔离宿主 JavaScript 权限。

回退前停操作并恢复 pending Journal。第三方可显式授权保留的旧包并提供全部 Manifest。仅换旧程序不恢复旧注册或目标；内置回退需合适兼容构建或一致恢复 Home、全部目标和 lock。revision 或预览不是完整备份。步骤见[升级指南](../guides/adapter-upgrades.md)，实际双包演练见[1.2.0 验收](../releases/1.2.0/validation.md)。
