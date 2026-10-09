---
title: SDK 操作控制契约
status: current
owner: project-maintainers
updated: 2026-10-09
---

# SDK 操作控制契约

[English](operation-control.en.md)

适用版本：1.3.0。实现见 [operation-service.ts](../../src/application/operation-service.ts)、[操作观察](../../src/observability/operation.ts)及 [OperationOptions](../../src/application/types.ts)。

OperationOptions 为业务方法最后一个独立参数，含 signal、timeoutMs、onProgress，不进入请求/保存计划/摘要。单调时钟从调用开始，timeoutMs 为 0–2147483647 整数；零期限或预先取消在业务 I/O 前失败。

进度只有 phase 和可选 completed/total，阶段为 prepare、lock-wait、apply、recover、maintenance、complete；成功以 complete 结束。回调同步异常和 Promise rejection 隔离，不等待异步观察者，不含路径/正文/秘密。内部 observer 保留附加桥接。apply 计数持久记录步骤，recover 计数已回退步骤，maintenance 计数完成对象；无可靠总数不发 total。

取消传播到准备、Git 进程组和锁等待，等待间隔默认 50 ms。POSIX Git 先 TERM，必要时 1 秒后 KILL 并等待 close。目录扫描、同步解析和插件调用在下一安全点响应。租约释放和计划引用/文件发布作为不可取消短收尾。

写入到持久 after-image 之间不响应取消；prepared、before-write、after-record、before/after-state 为安全点。回滚和恢复屏蔽已触发 signal，可能超过期限。外部变化阻碍回滚时返回恢复需求/冲突，不被普通取消掩盖。持久 committed 后锁定已提交结果，取消不阻止清理。维护意图持久化前可取消，之后完成可恢复删除。

结果 effects 区分 asset、metadata、adapter-upgrade，保留 changes；outcome 为 committed/unchanged，maintenance 为 complete/recovery-required。元数据 after 采用实际提交 revision。已提交但待清理不能重试原写操作；recovery.action 区分 recover 与 recover-maintenance。

服务先登记任务再调用用户回调；close 拒绝新任务，等待已接受操作、回滚及租约释放，重复返回同一 Promise，不隐式取消。

CLI --timeout-ms 包含前置查询和写操作；--progress 写 stderr，JSON stdout 一份文档。SIGINT/SIGTERM 请求安全取消，退出码取消 130、超时 124、恢复需求 3。

调用示例见[维护与控制指南](../guides/maintenance.md)，验证入口见[开发指南](../guides/development.md)。
