# 批次 A：不变量与验证矩阵

基线：2026-10-06，1.0.0。任务 A01。

| 不变量 | 已有证据（tests 下） | 批次 A 新增验收 |
| --- | --- | --- |
| committed Journal 是提交点；清理失败仍已提交 | execution.test.ts：committed cleanup failure；transaction-crash.test.ts：committed SIGKILL | A10：准备流程接入后复跑 |
| 待恢复事务阻断普通查询/预览 | application.test.ts：unfinished transactions block preview；application-transactions.test.ts：externally added quarantine | A09/A10：execute 先恢复，准备后新日志导致 revision 失效 |
| 准备不写活动状态或目标 | application.test.ts：new Home preview；planning.test.ts：deterministic plan, no writes | A08/A10：闸门暂停来源，检查状态/目标不变及其他操作可继续 |
| 执行复验身份、revision、授权、内容与外部输入 | planning.test.ts：stale revision / symlink children；application.test.ts：saved plans reject drift | A09/A10：准备期间撤销信任、变更插件/来源与父路径 |
| apply 不隐式重新规划 | application.test.ts：saved plans reject revision, target, and manifest drift | A06/A09：严格读取；execute 同样明确返回失效 |
| Home → 外部锁 → 目标锁；共享键不丢失 | locks.test.ts；transaction-crash.test.ts：two Homes preserve each other's keys | A07：缓存租约顺序；A10：两个服务并发准备与执行 |
| 保留外部修改、共享非受管内容 | planning.test.ts：preserve user config；execution.test.ts：external changes during rollback | A10：复跑原测试，不放宽指纹匹配 |
| repair 不升级内容或权限 | content-repair.test.ts：without upgrading；application.test.ts：revoked trust blocks repair | A08/A10：共享准备路径仍使用精确库存 |
| 未完成事务、计划、准备资源不被回收 | 尚无通用缓存回收 | A07：跨进程租约与持久计划引用；C 批次实现正式 GC |
| 静态插件预览不导入代码 | application.test.ts：plugin add preview imports no code | A08：插件副本可准备，但新插件 import 仅授权执行 |

## 测试边界

运行 `npm run test:fast` 建立本次工作基线。该套件包括真实本地 Git、跨进程锁和 SIGKILL 恢复；不证明打包候选、Linux/macOS 双平台或真实 Codex runtime 已验收。后者归 A12。

业务执行失败后：若所有资源有可验证的 before/after 证据，恢复到旧状态；若存在无法解释的外部修改或未记录写入，保留日志并报告恢复冲突，不能用“测试必须回滚成功”覆盖用户内容。

## 后续覆盖归属

A06 负责格式与计划读取；A07 负责租约及模拟回收竞争；A08/A09 负责正常路径与复验；A10 负责跨进程组合与崩溃。已有成熟场景复用测试，不复制一套同义测试。
