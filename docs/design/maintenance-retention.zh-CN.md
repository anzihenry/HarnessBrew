# C 批次：维护保留协议

## 策略与优先级（C01）

维护独立于 `cleanup`：后者处理安装内容，本协议处理宿主缓存和审计 revisions。
默认 TTL 为 30 天、每类保留最新 10 个对象、容量报告预算为 1 GiB。
调用者可以提供非负安全整数限制；容量不是提前删除对象的授权。
判定顺序为：

1. 不认识、归属不能证明、时间异常、大小未知或引用解析失败：`unknown`，不删除。
2. CURRENT、Journal before/next、有效计划及任何活跃缓存租约：`protected`。
3. TTL 内或每类最新保留数量内：`protected`。
4. 其余已证明归属且过期、无引用的对象：`deletable`。

报告包括总字节、保留字节、受保护字节和保留集合超过预算的字节。
未知对象也计入已知大小的保留预算；无法确定大小时不承诺总量准确。
受保护集合可能超过预算，不承诺磁盘总量一定小于配额。

`stateReferences` 保留 CURRENT revision、所有状态 catalog snapshot、内容来源（离线 repair 输入）、已注册插件签名缓存和用户 quarantine。
`journalReferences` 额外保留 before/next revision、两份状态中的缓存引用、步骤临时路径以及恢复/清理证据。
使用路径重叠判断，引用后代也保护祖先候选，不能通过删除上层目录绕过保护。
源快照即使可以重新下载也不因此成为可删对象。

缓存租约没有 TTL：PID 仍存活（含权限不足或 PID 重用）时保护整个缓存。
只读检查不会清理死亡租约；维护执行可清理已确认死亡的租约。
持久计划 references 损坏、未知临时文件或不安全路径时拒绝删除。
历史 cache root 仍受保存计划中的跨根 references 保护。

## 保存计划有效期

保存计划文件最后写入时间起 30 天后，`apply(planId)` 返回 `PLAN_STALE`，
`details.reason = "expired"`。此规则也适用于已有 v2/v3 保存计划。
不自动重规划，不改变 Home、目标文件或锁文件；调用方需要重新生成预览。
文件被外部触碰可能延长保留，但不会扩大删除权限。
维护的较短 TTL 不能让仍有效的计划变成可删对象。
删除后不存在的 ID 仍返回 `PLAN_NOT_FOUND`。

过期不是立即删除授权：持久 references 在后续回收事务核验并退休前仍保守保护其资源。
因此单独的 C01 策略不会移除引用或回收任何对象。
C02 将提供枚举与预览，C03 将实现复核、隔离与可恢复删除；C04/C05 再扩展对象类型。

## 预览（C02）

SDK `planMaintenance({ ttlMs?, keepNewest?, maxBytes? })`；CLI：

```sh
harnessbrew maintenance --dry-run --ttl-days 30 --keep-newest 10 --max-bytes 1073741824 --json
```

当前入口只生成预览，不执行删除。预览保存于缓存 `maintenance/<id>.json`，
包含路径、对象类型、大小、状态/原因、文件内容与设备/inode 指纹、引用摘要和策略。
预览枚举 `plans`、`prepared`、`restores`，未知缓存域保留；目录大小尚未核实的未知域以 0 报告，不能据此推断总磁盘占用。
新建 prepared/restore 目录由生产者写入 `.owner.json`；缺少有效归属记录的历史目录保留。
所有候选内部均使用 lstat 检查，不跟随 symlink；有效计划需通过现有严格 schema 和摘要验证。
损坏的保护记录或计划会让整轮候选判定为未知。活跃租约保护整个缓存。
过期计划的引用尚未退休时，其资源仍受保护。

预览是观测快照，不是删除授权；执行必须重新检查引用、路径身份和全部候选指纹。
任何当前事务待恢复时，应用层拒绝生成维护预览。预览不恢复事务、不修改 CURRENT 或目标文件。

## 回收执行与恢复（C03）

使用 `applyMaintenance(planId)` / `apply-maintenance <id>` 执行预览，
`recoverMaintenance()` / `recover-maintenance` 完成已记录但中断的回收。
执行要求 Home 已初始化。执行复核严格使用保存的时点和策略，新增候选不会自动纳入。

锁序为 Home store 锁 → 本 cache 的 leases guard。消费者只在短 guard 中登记租约，
然后释放 guard 才请求 Home 锁；维护若发现活跃租约立即返回 PLAN_STALE，不等待消费者。
维护持有 guard 直到回收完成，因此它与新租约登记互斥，不需要目标文件锁。
预览不构成稳定锁定；apply 总是再次验证状态 revision、引用摘要及对象身份/内容指纹。

仅限当前 cache 内且已过期、完整通过保存计划及引用摘要验证的计划 references 可以退休。
跨 cache 引用保守保留。退休引用本身也作为回收对象记录在同一日志中；未完成日志恢复前阻止新消费者，
所以不能在隔离计划后又开始使用已经退休的输入。

日志位于 cache/maintenance/transaction.json，先 fsync 写入逐对象证据，再 rename 到
maintenance/trash-<id>/<序号>；原目录和隔离目录均 fsync。
隔离后的对象再次核验；持久记录 deleting 阶段后按深度逐项检查 inode、设备、模式、文件摘要并删除，
对已删除的条目允许缺失。目录只在没有其他文件时 rmdir。
恢复不清理未记录的对象；发现身份变化、新增文件或改写数据时返回 RECOVERY_CONFLICT，保留日志与剩余数据。
新消费者遇到待恢复维护日志返回 RECOVERY_REQUIRED，需调用 recover-maintenance。
四个 SIGKILL 检查点覆盖意图持久化、隔离、删除意图与部分条目删除。

## 来源与插件缓存（C04）

预览/执行现在纳入 sources/snapshots/<摘要> 与 plugins/<签名摘要>。
来源快照必须只有 content 和 snapshot.json，声明身份与目录名/内容位置一致，且内容摘要可验证；
插件静态声明和完整目录摘要必须与签名目录名一致。检查不会 import 插件代码。
修改过、结构未知或含 symlink 的缓存保留，Git bare repositories 和锁目录不纳入自动删除。
来源多层父目录在预览和恢复时逐层 lstat 检查。

CURRENT 中全部 catalog snapshots 仍是现有查询输入，因此即使不是 selected 也保留；
contents origins 仍是离线 repair 输入，不能以“可以重新下载”为由回收。
已注册插件、有效计划的候选插件及全部声明资源受保护。
过期计划可释放同根候选引用，未被当前状态或其他有效计划使用的候选才进入 TTL/数量判定。
跨根引用仍保守保留，不通过远端 cache 的锁推断本地安全性。

回归覆盖断开原 Git 仓库后的 search/info/install/restore repair，
以及维护回收过期升级候选后，另一有效升级计划仍可离线 apply。
