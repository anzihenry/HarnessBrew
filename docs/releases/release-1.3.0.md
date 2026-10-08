# 1.3.0 候选发布说明

日期：2026-10-08。批次 C 加入保守维护、操作取消、期限、阶段进度与关闭排空。

维护先运行 `maintenance --dry-run`，检查对象与保护原因，再运行 `apply-maintenance <planId>`。中断后按错误建议运行 `recover-maintenance`。默认 TTL 为 30 天、每类保留最新 10 项、预算 1 GiB；预算仅用于报告，不授权删除受保护对象。有效保存计划至少保护 30 天，过期后必须重新生成，不能自动重算并执行。

运行中租约、CURRENT、有效计划的 baseRevision、注册插件、来源快照和用户 quarantine 都受保护。无法确认归属、跨缓存引用、仍被目录引用的历史与 bare Git 仓库保守保留，因此不保证总容量收敛到预算。revision 不是完整备份；回退仍须一致备份 Home、受管目标和 Bundle lock。

SDK 的最后一个独立参数接受 `signal`、`timeoutMs`、`onProgress`；CLI 对应 `--timeout-ms`、`--progress` 和 SIGINT/SIGTERM。期限从调用开始计算，回滚和恢复可超出期限。提交前取消在安全点回滚；durable commit 后仍返回 `outcome: committed`，清理失败通过 `maintenance: recovery-required` 表示。`close()` 拒绝新请求并等待已接受请求及租约结束，不隐式取消它们。进度仅包含阶段及计数，回调失败不影响事务，CLI JSON stdout 仍是一份文档。

Home/Journal/Bundle v1、普通保存计划 v2、升级计划 v3 保持不变。新增维护计划和维护日志独立存储。内置 Adapter 的运行时闭包签名可能变化，已有注册需显式检查和授权升级；不要直接替换注册或忽略 Bundle lock 校验。

候选包验收涵盖升级准备与维护竞争、多 Bundle apply 取消回滚、提交后清理失败恢复及 close 排空；还需对同一包执行完整测试、macOS/Linux gate 和真实 Codex 四项探针。最终证据见批次 C 验收记录。候选验证不代表 npm 发布或生产 provenance 验证。
