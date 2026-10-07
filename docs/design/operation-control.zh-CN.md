# SDK 操作控制契约（C06–C09）

所有业务方法接受独立的最后一个 `OperationOptions` 参数；旧调用不变。
选项包含 `signal?: AbortSignal`、`timeoutMs?: number`、`onProgress?: callback`。
选项不属于 ChangeRequest，不进入保存计划、引用或摘要。
超时以方法调用时刻的单调时钟起算；允许 0 到 2147483647 的整数毫秒。
零超时与预先 aborted 的 signal 在任何业务 I/O 前失败。

公开进度事件只包含 `phase` 和可选 `completed`/`total` 计数，
阶段集合为 prepare、lock-wait、apply、recover、maintenance、complete。
回调同步异常和 Promise rejection 均被隔离；不等待异步观察者完成业务。
事件不包含路径、请求内容、插件代码或凭据。

结果新增 `effects` 判别联合：asset、metadata、adapter-upgrade。
旧 `changes` 字段保留；新调用方建议穷尽处理 effects.kind。
执行结果 `outcome` 为 committed 或 unchanged，`maintenance` 为 complete 或 recovery-required。
提交后清理失败仍返回 committed，并附 machine-readable maintenance 状态；不得当作未执行重新规划。
元数据 effects.after 使用实际提交的 revision。
需要检查磁盘证据的失败仍使用 RECOVERY_REQUIRED/RECOVERY_CONFLICT，错误 recovery.action 指定 recover 或 recover-maintenance。

C06 建立接口、调用级时钟、预先取消、结果类型及回调隔离。
C07 接入准备/Git/锁等待检查点；C08 接入事务取消与 close；C09 完成稳定阶段与 CLI 集成。
最终语义要求：提交前取消安全回滚；恢复与回滚不受已经触发的 signal 限制，因此总耗时可能超过 timeout；
已提交后取消不能报告未提交；同步不可中断步骤在下一安全检查点响应。
close 拒绝新操作并等待已接收操作与租约释放，重复 close 返回同一个等待过程，不隐式取消任务。
