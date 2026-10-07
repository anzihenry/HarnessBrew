# B08：Adapter 升级格式兼容证据

A 基线为 `384caa0`；B08 不迁移活动 Home，不引入自动数据转换。

| 契约 | B 行为 | 旧数据与回退 |
| --- | --- | --- |
| CURRENT / Home / install / adapter-state / source-state | 字段及 version 1 不变；注册 signature、version、capabilities 在原有字段内更新 | A 解析器可读取结构；旧 Adapter 代码与当前注册不一致时仍拒绝执行，不能把结构兼容当成行为兼容 |
| Journal | version 1；原有 nextState 已包含完整 Home，steps 原本就允许多个 lockfile | 恢复基于旧状态和文件图像，不运行旧插件；待恢复事务必须先恢复，不能被升级覆盖 |
| Bundle lock / manifest | version 1，只有已有 adapterSignatures 的目标项变化 | pins、依赖、sources、roots、manifestDigest 不变；旧实现发现签名不匹配时拒绝重新应用 |
| ChangePlan | version 1 字段不变 | 候选授权和多 lock 输入放在执行输入/保存预览外层，不向严格 v1 计划添加字段 |
| saved-plan | 普通操作继续 v2；adapter.upgrade 使用 v3，增加 adapterUpgrade、lockUpdates | B 可读 A v2；v1 返回 PLAN_STALE；A 拒绝 v3，需重新预览，不降级/转换授权证据 |
| Adapter package/protocol | 第三方声明及协议仍 v1 | 不增加必需字段；静态能力要求未知时返回 null，显式摘要授权后检查实际导出 |
| 内置 Adapter 签名 | 新构建规则 builtin-closure/1，涵盖 emitted 闭包及生产依赖锁 | 即使实现声明 version 未变，也需要显式 upgrade；不得忽略 signature 差异 |
| CLI result / SDK | 原 result v1 外壳不变；新增查询方法、请求和命令 | 老消费者的现有命令保持字段形状；新命令结果必须按 command 识别 |

B08 时对 `src/domain/{home-state,state,bundle,plan}.ts` 和 `src/transactions/journal.ts` 与 A 基线逐字比较无改动。多 lock 支持复用 v1 lockfile journal steps；新增字段只存在 saved-plan v3 和内部 ExecutionInput。后续集成必须维持此边界。

测试中的 `tests/fixtures/compatibility/a-saved-plan-v2.json` 是按 A 严格 schema 固定的最小 metadata 预览 fixture；它用于解析兼容，不伪装为可在任意主机应用的预览。测试另覆盖 v3 roundtrip、伪装成 v2 的升级拒绝和真实 v1 pending journal 恢复。A 安装的实际包级升级在 B10 验收。

回退前停止操作并恢复 pending journal。第三方可使用保留的旧包再次显式授权升级回旧实现（Bundle 须提供全部 Manifest）。仅换回 A 程序不会恢复旧 signature，也不能保证目标与旧 Adapter 一致。内置 Adapter 回退需要与旧实现匹配且支持升级流程的构建，或在停机状态恢复升级前完整 Home、所有目标和全部 Bundle lock 的一致备份。保留旧包和一致备份，不覆盖有外部修改的文件，不把可重建 preview 当作备份。
