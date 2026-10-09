---
title: 文件锁与缓存租约
status: current
owner: project-maintainers
updated: 2026-10-09
---

# 文件锁与缓存租约

[English](file-locks.en.md)

适用于 macOS/Linux 本机进程协调，依赖目录可见性和原子 rename；不是跨主机分布式锁。实现见 [file-lock.ts](../../src/transactions/file-lock.ts) 和 [cache-leases.ts](../../src/application/cache-leases.ts)。

## 锁协议

Home、来源缓存和资源使用 withFileLock。命名空间常驻，空目录不表示锁被占用。每次调用创建独立 `<pid>-<uuid>.json`，文件名不复用。

Bakery 算法先原子发布 ticket=null 的选号记录，再扫描最大票号并发布加一的十进制大整数，等待 (票号, UUID) 更小的参与者退出。临时文件完成写入后才 rename 发布。释放只删除本次唯一记录，不删除命名空间或后继者记录。

死亡 PID 的独立记录可以重验清理；活 PID、权限不足和 PID 复用保守保护，超时返回 LOCK_TIMEOUT，不按时间夺锁。无法解释的已发布记录返回 LOCK_CORRUPT 并保留证据。旧 owner.json 不兼容，旧进程必须停下后人工处理。

事务顺序为 Home → 同用户外部锁 → 排序目标锁。准备读取快照后释放事务锁，再准备 Git、插件和内容；提交重获锁并复验。待恢复 Journal 阻断普通查询和预览。

## 租约与引用

消费者先在短 .leases.guard 内发布独立 leases 记录，释放 guard 后执行工作。租约贯穿准备到提交或预览引用发布。计划先发布 references，再发布计划，创建进程退出后引用继续保护输入。

消费者释放事务锁后在不可取消短 guard 移除租约。租约释放失败保留保护，不覆盖业务错误或已提交结果。别名按物理 Home 共用缓存，历史缓存根分别登记租约和持久引用。

维护使用 Home → cache guard，发现活跃租约立即拒绝旧计划，不等待消费者；持 guard 复核并回收。损坏引用、未知临时对象和不安全路径保留。旧程序不参与租约，混合版本运行期间禁止回收。对象保留规则见[维护契约](maintenance-retention.md)。

## 验证

[锁测试](../../tests/locks.test.ts)、[崩溃测试](../../tests/transaction-crash.test.ts)和[租约测试](../../tests/cache-leases.test.ts)覆盖多进程互斥、选号/写入/释放 SIGKILL、活 PID 保护、损坏记录及持久引用。运行方式见[开发指南](../guides/development.md)。
