---
title: 维护与操作控制
status: current
owner: project-maintainers
updated: 2026-10-09
---

# 维护与操作控制

[English](maintenance.en.md)

## 缓存维护与操作控制

先用 `maintenance --dry-run --json` 保存回收预览，再用 `apply-maintenance <planId>` 执行该预览；`recover-maintenance` 恢复中断的回收。它与处理安装内容的 `cleanup` 分开。

默认保留 30 天、每类最新 10 个对象，并按 1 GiB 预算报告。可用 `--ttl-days`、`--keep-newest`、`--max-bytes` 调整。CURRENT、恢复证据、活跃租约、有效计划输入、catalog/repair 来源和已注册 Adapter 的保护优先于预算。未知对象及用户 quarantine 保留；受保护数据可能超预算。revisions 是审计快照，不是完整备份。安装保存计划 30 天后过期，apply 返回 `PLAN_STALE`，不会自动重规划。

SDK 方法接受独立的最后一个选项参数：

```ts
const controller = new AbortController();
try {
  const preview = await harness.plan(request, {
    signal: controller.signal,
    timeoutMs: 30_000,
    onProgress: event => console.error(event.phase, event.completed),
  });
  const result = await harness.apply(preview.planId);
  console.log(result.outcome, result.maintenance, result.effects);
} finally {
  await harness.close();
}
```

`effects` 按 kind 区分 asset、metadata、adapter-upgrade，旧 `changes` 字段保留。
`outcome` 区分 committed/unchanged；`maintenance: "recovery-required"` 表示已提交结果需要清理，不能重试原写操作。
错误恢复指令区分 recover 和 recover-maintenance。

超时从调用时开始计算。提交前取消会安全回滚；回滚和恢复可以超过截止时间。提交后取消仍返回已提交结果。
同步工作与插件调用在下一安全检查点响应；维护意图持久化后完成可恢复删除。
`close()` 拒绝新工作、等待已接收操作和租约释放，不隐式取消；重复调用幂等。进度回调异常不影响业务结果。

CLI `--progress` 仅向 stderr 写阶段/计数，`--json` stdout 保持单一文档；`--timeout-ms` 设置整个命令的期限。
SIGINT/SIGTERM 请求安全取消，取消退出码 130，超时退出码 124。进度不含路径、正文或凭据。
