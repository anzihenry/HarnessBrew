# ADR 001：准备结果、升级授权与格式演进

日期：2026-10-06。状态：采纳；A02。A 批次实施准备结果和兼容边界，B 批次实施 Adapter 升级 API。

## 准备与提交

Application 先读取受锁保护的完整快照，释放事务锁，再进行来源准备、插件副本准备和内容 staging。随后重获 Home → 用户外部锁 → 目标锁，恢复日志并复验，最后写入。恢复或其他写入改变 revision 后准备结果失效，返回 PLAN_STALE；不自动重规划。

execute 保持可自动恢复的入口语义：初始化后先在短 session 内恢复并读取状态，再进行准备。plan/query 遇待恢复日志仍返回 RECOVERY_REQUIRED；apply 不重新准备。第一次 plan 不初始化 Home。首次 saved metadata plan 应用时只接受与原始初始化种子完全一致的状态，不能把任意新 revision 当成原 revision。

准备产物使用版本化数据文档，至少包含请求、baseRevision、物理 Home 身份、candidate 或 plan/catalog、外部输入指纹、内容暂存引用与诊断。回调、registry、GitClient 不序列化。摘要只检查完整性，不替代授权与执行验证。

## 格式兼容矩阵

| 格式/接口 | A 批次 | 读取旧格式 | 旧程序读取新增格式 |
| --- | --- | --- | --- |
| CURRENT、Home/安装/来源/Adapter 状态、内容库存 | 保持 v1 字段及语义 | 继续支持 v1 | 无新增字段 |
| asset、tap、snapshot、manifest、Bundle lock、Adapter 协议 | 保持 v1 | 不变 | 不变 |
| ChangePlan、Journal | 保持 v1，暂存不进入计划与日志格式 | 不变 | 不变 |
| saved-plan | 使用 v2，增加物理身份及准备资源证据 | v1 拒绝为 PLAN_STALE，重新预览 | 旧程序拒绝 v2；重新生成计划 |
| 缓存租约/持久引用 | 新内部 v1 格式，独立缓存命名空间 | 无旧数据需迁移 | 旧程序不参与新 GC，混合版本期间不运行 GC |
| CLI result、公共 SDK | 保持 v1 和当前字段 | 不变 | 不变 |

saved-plan 属可重建缓存，v1 不转换成缺乏新证据的 v2，也不删除原文件。A 不需要活动 Home 迁移。A 的包可以回退，但 v2 预览必须重新生成；新 GC 尚未提供，禁止用未来 GC 回收仍由旧版本进程使用的缓存。

B 的多 lock 输入可以扩展内部 ExecutionInput；Journal 已支持多个 lockfile step，若不改变其验证语义，不必为数组本身升级 Journal。实际引入新的持久字段须另定版本，不向严格 v1 解析器添加字段。SDK 增加请求联合类型可新增，但 JSON 结果的破坏性变化必须升级结果版本。B08 用旧 fixture 证明最终兼容结论。

## Adapter 身份

继续区分 protocol（调用协议）、version（实现声明）与 signature（确切实现摘要）。内置签名未来采用构建时确定的运行时代码闭包及依赖锁摘要；排除文档、source map 和时间戳。签名覆盖规则本身版本化，规则变化作为 Adapter 升级处理。不得为了绕过升级而忽略摘要变化。

第三方签名仍覆盖安装包文件库存和已安装依赖。插件拥有宿主进程权限；授权仅表达允许运行此候选及其可提交的操作能力，不声称隔离任意 JavaScript 行为。

## B 批次升级契约（拟新增）

1. SDK `inspectAdapterUpgrade({ name, module })` / CLI `adapter inspect-upgrade <name> --module <path>`：静态检查，不 import；返回候选摘要、声明、当前/候选能力、受影响 manual 与 Bundle binding。返回值不是 planId。
2. `plan/execute({ kind: 'adapter.upgrade', name, module, authorizedSignature, capabilities, bundleFiles? })`；CLI 使用 `adapter upgrade <name> --module <path> --authorize-signature <digest> --capability <type> [--bundle-file <path>] [--dry-run]`。显式摘要授权允许加载候选代码；dry-run 本身不构成代码加载授权。
3. apply-plan 使用保存的授权摘要与能力，重新验证字节，再执行原计划。不追加能力、不切换候选、不重新解析到最新资产。

相同签名和相同投放无变化时为幂等；能力集变化不能借幂等绕过检查。B 第一版不提供无显式摘要的自动确认命令。

## 五类决策示例

- **手动安装**：已有 skill 固定 commit X，Adapter v1→v2。授权候选摘要后按 X 重新投放；注册、操作记录、目标一次提交。用户自行改过的整文件/链接拒绝覆盖，不提供通用 force。
- **两个 Bundle**：binding A/B 都引用此 Adapter，必须提供两份 Manifest。核对目录、ID、声明和当前 lock 的固定闭包；只更新 Adapter 身份与投放。缺 A/B 任一输入返回 LOCK_MISMATCH，并在 details 列出 missingBindings；无写入。
- **增加能力**：候选需要额外操作能力但未显式包含于授权集合，返回 CAPABILITY_DENIED。静态检查可以展示差异，不能替调用方授予。
- **旧格式**：旧 saved-plan 在 A 中返回 PLAN_STALE，提示重新预览；活动 v1 Home 无迁移。未来涉及 Home 新格式时提供显式 migrate 的预览/备份/执行，不通过普通 install 隐式转换。
- **未完成旧事务**：A 保持 v1 Journal 可恢复；若未来版本无法解释旧 Journal，先用兼容版本 recover，再迁移。迁移失败保留原 CURRENT、日志和备份，不提交半迁移状态。

其他错误沿用：候选字节变化 ADAPTER_CHANGED；父路径/状态/输入漂移 PLAN_STALE；来源撤销 SOURCE_UNTRUSTED；目标修改 TARGET_MODIFIED；资源接管 OWNERSHIP_CONFLICT。P3a 遇活动 Bundle 返回 ADAPTER_IN_USE 和 binding 列表，P3b 再开放联合升级。

## 缓存引用与锁顺序

A 的准备保护必须先于读取/创建缓存，贯穿到 execute 完成或 plan 引用持久化。apply 先取得缓存保护，再读取持久计划。消费者可并发持有独立租约；未来回收器在同一短协调锁内确认没有活跃租约再标记对象。该协调锁不跨业务 I/O、不在持有 Home 锁时等待长任务。

租约死亡判断不能只依赖 TTL；活进程不会因慢网络被回收。进程退出遗留租约可重验 PID 后回收，PID 复用时保守保留。持久计划引用与进程租约分开，避免计划在创建者退出后失去保护。GC 是 C 批次功能，A 提供协议与模拟回收测试。

## 验收与版本选择

A 仅改变内部执行时序及临时计划版本，公共调用保持兼容，拟以 minor 候选验证；最终包号在 A12 选择未发布版本，不覆盖 1.0.0。B 版本取决于实际格式迁移，不能预先保证 minor。A02 的完成不代表任何 B API 已实现。
