# 架构改进批次任务拆分

日期：2026-10-06。状态：全部待实施。

设计约束、预算和发布策略见 [落地计划](architecture-improvement-plan.zh-CN.md)。本清单将三批工作拆为 32 个可验收任务；新增路径和接口名称是实施建议，现有文件以仓库实际结构为准。

## 使用规则

- 每个任务完成代码/文档、相关测试和评审证据后才能勾选；只有设计任务不要求运行业务测试。
- 任务可以单独提交，但不等于独立发布；PR 编号沿用落地计划。较大的 PR 可以按任务拆分，原有验收门槛不降低。
- 前置依赖表示必须已满足的交付条件。无依赖冲突的任务可以分别推进；这不改变跨进程事务的锁顺序。
- 任务记录格式建议为：状态、实现 commit/PR、测试命令与结果、遗留限制。发布任务额外记录候选包摘要和各平台报告。
- 本清单不新增工程日预算：A 仍为 8–13、B 为 8–13、C 为 7–11；A02 明确格式和升级范围后重估。持续集成和真实运行环境等待时间单独记录。

| 批次 | 任务 | PR 映射 | 完成条件 |
| --- | --- | --- | --- |
| A：边界与锁外准备 | A01–A12 | 01–04 | 慢来源不持有事务写锁，恢复语义不变 |
| B：Adapter 原子升级 | B01–B10 | 05–07 | 注册、目标、受影响 Bundle lock 一致提交 |
| C：长期维护与 SDK | C01–C10 | 08–10 | 回收保护有效引用，取消与提交结果可区分 |

## 批次 A：边界整理与锁外准备

<a id="a01"></a>
### A01 — 不变量与现有测试映射

- [x] 完成；PR 01；前置：无。
- 范围：`docs/design/`、`tests/application-transactions.test.ts`、`tests/transaction-crash.test.ts`、`tests/locks.test.ts`、内容恢复测试。
- 工作/交付：逐条列出设计不变量、已有覆盖、缺失场景及负责补齐的后续任务；记录当前快速测试基线。
- 验收：每个不变量能定位到测试或任务编号；明确 committed、回滚冲突、查询阻断和外部修改的预期，不以测试数量替代覆盖说明。

完成证据：提交主题 `docs(A01): map architecture invariants and baseline`；`npm run test:fast`：177/177 通过；矩阵见 batch-a-invariants.zh-CN.md。

### A02 — 升级、授权和格式演进 ADR

- [x] 完成；PR 01；前置：A01。
- 范围：`docs/design/`，核对 `domain/bundle.ts`、`domain/home-state.ts`、`transactions/journal.ts`、保存计划及 CLI 格式。
- 工作/交付：确定插件静态检查→候选摘要授权→完整规划的 API/CLI；明确内置签名覆盖范围、多 Bundle 输入、错误码、格式读写兼容矩阵和必要迁移策略。
- 验收：给出手动安装、两个 Bundle、新增能力、旧格式和未完成旧事务五类完整示例；不存在“先替换注册、稍后更新目标/lock”的中间成功状态。普通 dry-run 不加载新插件。

完成证据：提交主题 `docs(A02): decide preparation and upgrade compatibility`；ADR 001 固定 API/CLI、五类示例、版本矩阵与恢复规则；交叉核对现有严格解析器，无业务代码变更。

### A03 — 可重复规模基准

- [x] 完成；PR 01；前置：A01。
- 范围：拟新增 `scripts/benchmark/`，现有 catalog、sources、Journal、锁入口的内部测量挂点。
- 工作/交付：10/100/1000 资产 fixture、小文件/较大文件两类数据；测量准备、锁等待/持有、扫描量、日志写入量与总耗时，保存命令和基线报告。
- 验收：输入固定、输出含环境和规模，重复运行可比较；observer 默认关闭，其失败不能影响业务；不记录文件正文和秘密。不设跨机器绝对耗时门槛。

完成证据：提交主题 `perf(A03): add scoped observations and scale baseline`；build 及独立 TMPDIR 快速测试 178/178 通过；六组完整基准见 docs/benchmarks/batch-a-baseline.json，运行范围与互扰说明见 README。

### A04 — 提取应用用例

- [x] 完成；PR 02；前置：A01、A02。
- 范围：`application/service.ts`、`application/requests.ts`，拟新增 `application/use-cases/`。
- 工作/交付：提取来源、Adapter、安装/Bundle、维护处理器；service 保留公共入口、解析、生命周期和组合。
- 验收：CLI/SDK 行为、错误码及持久化格式不变；同一请求仍走同一业务实现；快速测试通过，不夹带锁语义变更。

完成证据：提交主题 `refactor(A04): extract application preparation use cases`；快速测试 178/178 通过；来源、Adapter、catalog、安装/Bundle 和维护移出 service，协议与锁时序不变。

### A05 — 窄接口、共享类型与模块约束

- [x] 完成；PR 02；前置：A04。
- 范围：`application/types.ts`、`diagnostics/doctor.ts`、`ports/`、执行 I/O；拟新增架构检查脚本。
- 工作/交付：移动 diagnostics 共享契约；为来源准备、计划缓存和必要执行 I/O 提供可注入接口；配置允许的依赖方向并接入检查命令。
- 验收：diagnostics 不反向依赖 application；检查脚本能拒绝禁止的 import；在应用层可注入慢来源/失败 I/O，而无需修改全局函数。

完成证据：提交主题 `refactor(A05): enforce boundaries and inject application ports`；build、架构检查及快速测试 180/180 通过；来源/文档/状态故障注入与禁止导入检查有专项测试，公共入口签名不变。

### A06 — PreparedChange 与计划存储契约

- [x] 完成；PR 03；前置：A02、A05。
- 范围：`application/service.ts` 的 Saved、`application/cache.ts`、`domain/plan.ts`；拟新增准备结果与计划存储模块。
- 工作/交付：定义纯数据 PreparedChange、严格解析器、身份/摘要/输入指纹及准备资源引用；提取保存和读取计划的逻辑，按 A02 处理旧计划。
- 验收：格式错误、Home 身份变化、摘要不匹配均拒绝；数据可序列化；加载计划不会运行网络准备或隐式重新求解。

完成证据：提交主题 `feat(A06): validate and persist prepared changes`；快速测试 180/180、新增格式/物理身份专项 2/2、packaged 19/19、regressions 3/3 通过。v1 预览明确失效，Home/Journal 保持 v1；修复 macOS 路径别名误判。

### A07 — 准备资源租约与生命周期

- [x] 完成；PR 03；前置：A06。
- 范围：缓存、锁协议、计划存储；`docs/design/file-lock-protocol.zh-CN.md`。
- 工作/交付：定义进程活跃租约与持久计划引用的区别；实现获取保护后读取、原子转交计划引用、释放及崩溃遗留识别；写清与 Home/外部锁的顺序。
- 验收：消费者与模拟回收器竞争时资源不丢失；生产者在登记或发布任一点退出都不会留下可被误认成完整输入的数据；不因超时清除活进程的保护。

完成证据：提交主题 `feat(A07): protect preparation caches with process leases`；快速测试 185/185、packaged 19/19、regressions 3/3 通过；跨进程/SIGKILL、嵌套并发消费者、持久引用和异常遗留均有验证。

### A08 — 锁外准备与共享入口

- [x] 完成；PR 04；前置：A06、A07。
- 范围：应用用例、`sources/manager.ts`、`application/restore.ts`、`application/adapters.ts`、`execution/content.ts`。
- 工作/交付：Git 拉取、可提前 staging 的内容及插件副本准备移到事务外；plan/execute 共用准备路径，apply 使用保存结果；有待恢复日志时普通预览继续阻断，execute 保留先恢复再准备的语义。
- 验收：闸门暂停 Git 时，同 Home 查询及其他 Home 独立写操作可完成；准备不修改活动安装、目标和 lock；新插件授权规则不变。

完成证据：提交主题 `feat(A08): prepare sources adapters and content outside transactions`；快速测试 185/185、新增并发/暂存专项 2/2、packaged 19/19、regressions 3/3 通过。可控慢来源期间同 Home 查询和另一 Home 写入完成；内容先缓存暂存再经 Journal 发布，跨设备保留验证复制回退。

### A09 — 锁内复验及初始化/恢复竞态

- [x] 完成；PR 04；前置：A08。
- 范围：`transactions/coordinator.ts`、`execution/validate.ts`、应用执行入口、StateStore 初始化。
- 工作/交付：集中执行前复验；处理首次初始化、多个服务竞争、准备完成后出现待恢复事务等路径；恢复改变 revision 后拒绝旧准备结果。
- 验收：revision、信任、能力、插件、来源、Manifest/lock、目标及父路径漂移均拒绝且不产生部分写入；初始化仅允许明确验证过的 revision 绑定；execute/apply 均不静默重规划。

完成证据：提交主题 `fix(A09): revalidate prepared changes at commit boundaries`；架构检查、快速测试 194/194、packaged 19/19、regressions 3/3 通过；复验物理 Home 与 revision、初始化父身份；路径别名共用缓存，历史缓存输入租约贯穿准备至提交。

### A10 — 并发与故障专项验收

- [x] 完成；PR 04；前置：A09。
- 范围：`tests/application-transactions.test.ts`、真实子进程测试、计划与内容恢复测试。
- 工作/交付：覆盖两个服务同时准备、准备时撤销信任、共享目标竞争、准备进程 SIGKILL、执行各关键点 SIGKILL。
- 验收：A01 中属于批次 A 的缺口关闭；恢复结论为完整旧状态、完整新状态或明确冲突；跨 Home 共享文件无丢失更新。

完成证据：提交主题 `test(A10): cover prepared transactions under contention and crashes`；快速套件 203/203 通过，补充后专项 11/11 通过；A01 矩阵已映射到真实 Application SIGKILL、跨 Home 竞争、插件/暂存漂移和历史缓存引用测试。

### A11 — 基准复测与文档收口

- [x] 完成；PR 04；前置：A03、A10。
- 范围：基准报告、当前架构及中英文使用文档中的受影响部分。
- 工作/交付：同环境复测并说明锁持有时间构成；更新计划失效、首次初始化、缓存租约和执行准备行为。
- 验收：Git 等待不计入 Home/外部事务写锁持有时间；总耗时或 I/O 的显著退化有解释和处理结论；保留提交前完整性复验。

完成证据：同机完整六组基准见 docs/benchmarks/batch-a-after.json（干净源码 aa9b5fd）；Home 锁持有下降 76.8–96.7%，外部锁下降 77.9–96.7%，单次总耗时下降 4.4–31.8%。更新中英文架构与 README，说明显式重试、格式兼容、首次初始化、租约及 staging 消费；性能结论限定为单次来源规模基准。提交：docs(A11): report preparation benchmarks and execution boundaries。

### A12 — 发布 A 候选验收

- [x] 完成；PR 04 收口；前置：A11。
- 范围：现有发布脚本、候选包、平台与 runtime 报告。
- 工作/交付：执行快速、packaged、regressions、release gate、Linux/macOS 与真实 Codex preflight；按 A02 确定版本和回退说明。
- 验收：各平台/运行时报告引用同一个候选包摘要；必需检查无缺项；缺少真实运行环境时保持发布验收未完成。发布操作另按实际发布流程执行。

完成证据：本地候选验收完成：1.1.0，源码 2689d4a，SHA-256 fe505af0bd57818596f64ef46ca77b0f88ebc8d27968e05391050df25ce698c9。fast 205/205、packaged 19/19、regressions 3/3；Linux Docker/macOS gate 与真实 Codex 四项均通过，同摘要证据校验通过。失败历史、平台限制及回退见 docs/releases/batch-a-acceptance.zh-CN.md；未执行生产发布，本地证据不替代受保护 workflow。提交：docs(A12): record verified batch A candidate acceptance。

## 批次 B：Adapter 原子升级

### B01 — 候选身份与静态检查

- [x] 完成；PR 05；前置：A02、A05。开发可在 A 后续工作期间推进，集成依赖发布 A 的接口。
- 范围：`application/adapters.ts`、`domain/adapter.ts`、内置 Adapter 构建身份。
- 工作/交付：实现候选包检查、签名覆盖清单、声明/能力差异、受影响安装列表；固定与候选摘要绑定的结果。
- 验收：候选代码写入标记文件的测试证明静态检查未 import；依赖/入口变化能被摘要识别；内置候选来自实际构建产物。

完成证据：静态检查 SDK 提供候选声明、签名覆盖、能力上限和受影响安装/binding；旧插件无静态能力声明时明确返回 unknown（null），授权加载时继续核验实际要求。内置签名来自 emitted runtime 闭包与生产依赖锁，加载时复核构建清单。专项 2/2，架构检查通过。提交：feat(B01): inspect adapter candidates and bind builtin build identity。

### B02 — 显式授权加载与完整升级预览

- [x] 完成；PR 05；前置：B01、A06–A09。
- 范围：请求解析、公共类型、CLI、registry、准备结果存储。
- 工作/交付：按 ADR 接入候选摘要授权和能力选择；在授权后执行候选规划，生成可保存的完整差异。
- 验收：静态检查结果不可当作可执行计划；授权后换包、增加未授权能力、apply 前漂移均拒绝；预览不更新活动注册或目标。

完成证据：接入 inspect-upgrade / adapter upgrade CLI 与 SDK、显式候选摘要和重复 capability 参数；授权后形成含注册差异和目标差异的 saved-plan v3，静态检查不产生 plan ID。授权错误、能力不足、候选漂移、apply 前漂移和只读预览专项 2/2，架构检查通过。执行暂由显式保护拒绝，按顺序由 B04 接入统一事务。提交：feat(B02): authorize and persist adapter upgrade previews。

### B03 — 精确资产输入与手动升级 Planner

- [x] 完成；PR 06；前置：B02。
- 范围：安装状态、catalog/内容读取、`planning/plan.ts`、资源比较。
- 工作/交付：从当前安装固定资产版本；补齐必要的精确内容读取/恢复路径；只重规划目标 Adapter 的 placement，生成旧操作删除与新操作变更。
- 验收：资产 commit、内容摘要和依赖闭包不变；其他 Adapter 不受影响；资源迁移保留外部内容；活动 Bundle 存在时列出 binding 并拒绝手动升级。

完成证据：升级从已安装 pins/内容 provenance 准备精确 catalog，不跟随最新 tap；Planner 只重投放指定 Adapter，保留其他投放。缓存丢失可从精确 commit 重建，损坏内容须先显式 repair；活动 Bundle 在手动阶段列出 bindings 并拒绝。专项 5/5。提交：feat(B03): pin assets and scope adapter upgrade planning。

### B04 — 注册与目标的统一事务

- [x] 完成；PR 06；前置：B03。
- 范围：`execution/validate.ts`、`execution/state.ts`、`transactions/coordinator.ts`、Journal。
- 工作/交付：同一候选状态包含新注册、资源和 fingerprints；执行验证显式区分当前身份与获授权候选身份；失败依赖旧状态证据回滚，不要求重新运行旧插件。
- 验收：无先发 metadata 再改文件的两阶段业务提交；同版本重复操作按定义幂等；回滚恢复旧注册与资源；外部修改进入明确恢复冲突。

完成证据：执行端显式验证旧注册→获授权候选转换及资产/其他 Adapter 不变，再在同一个 Journal 中发布目标和注册；回滚使用真实旧状态，不加载旧插件。专项 8/8（含 saved apply、幂等、目标写后与状态发布后回滚），架构检查通过。提交：feat(B04): commit adapter registration and targets atomically。

### B05 — 手动升级专项验收

- [x] 完成；PR 06；前置：B04。
- 范围：应用、规划、执行、崩溃测试和打包 CLI 测试。
- 工作/交付：覆盖内置/第三方、链接/文件/共享键区块、能力变化、缓存丢失、摘要漂移和关键点 SIGKILL；验证最终包内 Adapter 身份。
- 验收：P3a 完整通过；不支持的资源重叠或 Bundle 路径明确拒绝，无部分安装。该节点可以单独形成候选，但不能宣称已支持 Bundle 升级。

完成证据：fast 225/225、packaged 19/19；补充能力替换与符号链接边界专项 2/2。覆盖 5 个真实 SIGKILL 点、内置 skill/agent/instruction/MCP、外部文本保留、缺失缓存、候选漂移、旧插件缺失回滚及幂等。包内 CLI 验证 emitted identity 与注册升级一致；此节点 Bundle 升级仍明确拒绝。提交：test(B05): verify manual adapter upgrades and crash recovery。

### B06 — Bundle 范围与输入验证

- [x] 完成；PR 07；前置：B03、A02。
- 范围：`domain/bundle.ts`、Bundle 用例、请求解析及 CLI。
- 工作/交付：接收全部受影响 Manifest 路径，按 ID 和物理目录匹配 binding；核对当前 lock、声明和资产闭包；生成仅更新 Adapter 身份所需的 lock 内容。
- 验收：漏项、重复/路径别名、Manifest 缺失、声明漂移、额外 checkout 均有确定处理；不自动更新资产版本或未请求的 checkout。

完成证据：验证全部受影响 Manifest 的 ID+物理目录、当前要求/placements、锁声明摘要、来源与已安装闭包，生成只替换目标 Adapter 签名的 lock 集合。漏项返回 missingBindings，别名重复/额外 checkout/声明漂移拒绝；联合预览不写状态/lock，提交暂由 B07 保护。升级及 Bundle 专项 16/16。提交：feat(B06): validate complete bundle upgrade inputs。

### B07 — 多 lock 原子提交与恢复

- [x] 完成；PR 07；前置：B04、B06、B08。
- 范围：ExecutionInput、PreparedChange、执行验证、协调器、Journal 和恢复。
- 工作/交付：将单 lock 输入扩展为文件更新集合；对注册、目标及所有 lock 统一做重叠检测、加锁、预条件验证、写入和恢复。
- 验收：任意一个 lock 被修改时整笔事务拒绝；任意 lock 写入点崩溃后无部分成功；手动安装与多个 Bundle 混用保持一致。

完成证据：B08 前置已完成。提交 1d84cc0：ExecutionInput lockUpdates 集合与注册/目标共用同一 Journal；复核全部 Manifest/lock，限制只改授权 Adapter 身份，统一重叠检测、加锁、写入和提交前字节验证。专项 9/9、架构检查通过（上轮工具结果）；每个 lock after-record SIGKILL 可回滚，after-write 缺少完成证据时保留日志并拒绝恢复，未宣称部分成功。

### B08 — 格式兼容及迁移实现

- [x] 完成；PR 07；前置：A02、B06；须在 B07 集成完成前落实。
- 范围：受影响格式的解析器/写入器、迁移入口、旧格式 fixture、备份与回退文档。
- 工作/交付：按兼容矩阵实现必要版本升级和显式迁移；若确认无需迁移，提交字段与语义兼容证据，不能直接跳过此任务。
- 验收：旧格式可按承诺读取或明确拒绝；未完成旧事务不会被新迁移覆盖；迁移中断可恢复，备份可验证。旧 CLI JSON 消费者的变化有说明。

完成证据：按依赖先于 B07 完成。与 A 基线逐字核对 Home/install/Bundle/ChangePlan/Journal schema 无改动；普通 saved-plan v2 继续读取，升级 v3 严格校验授权字段对应关系，v1 明确失效。固定 v2 fixture、v3 roundtrip 和 pending v1 journal 恢复专项 4/4。无活动 Home 迁移；回退限制及备份要求见 batch-b-compatibility.zh-CN.md。提交：test(B08): establish adapter upgrade format compatibility。

### B09 — 联合升级与回退验收

- [x] 完成；PR 07；前置：B05、B07、B08。
- 范围：Bundle reproduction、CLI/SDK 契约、多文件 crash fixtures。
- 工作/交付：完成两 Bundle 共享、手动混用、同文件/父子路径冲突、lock 外部修改和迁移/回退演练；更新中英文用法。
- 验收：注册、目标、锁签名和状态一致；未修改资产版本；每个不支持场景有稳定错误及可行动信息。

完成证据：fast 243/243、packaged 19/19、regressions 3/3；联合/兼容专项 14/14。验证两个 Bundle+手动安装、CLI 重复 bundle-file、相同资源与父子路径冲突、逐 lock 漂移、提交期间外部改锁、显式旧插件反向升级及一致 Home/目标/lock 备份回退。中英文用法和可行动升级错误已更新；格式边界沿用 B08。提交：test(B09): verify joint upgrade rollback and document usage。

### B10 — 发布 B 候选验收

- [x] 完成；PR 07 收口；前置：A12、B09。
- 范围：与 A12 相同的候选包和平台/runtime 发布链路。
- 工作/交付：执行全部必需 gate；真实打包升级覆盖旧安装；记录格式版本、升级指令和回退条件。
- 验收：同一候选包通过跨平台与真实 Codex 验收；保留恢复所需旧包和备份；无证据的兼容性声明不得进入发布说明。

完成证据：本地 1.2.0 候选验收通过：源码 fc40a3e，SHA-256 1d61c99b85ed663a89582e828751656c4dad678db571b75073741dc7690019de。fast 243/243、packaged 19/19、regressions 3/3、Linux/macOS gate 和真实 Codex 四项均通过并验证同一包身份。保留实际 A 1.1.0 包，完成其手动+两 Bundle 安装→B 升级→一致备份回退演练。报告及边界见 docs/releases/batch-b-acceptance.zh-CN.md；未正式发布。提交：docs(B10): record verified adapter upgrade candidate acceptance。

## 批次 C：长期维护与 SDK 操作控制

### C01 — 回收策略与引用集合

- [x] 完成；PR 08；前置：A07、A09。
- 范围：缓存、状态、计划与 Journal 数据模型，拟新增维护用例。
- 工作/交付：定义 TTL/保留数量/容量策略及优先级；计算 CURRENT、Journal、有效计划、租约、活动/选中来源和 Adapter 引用；明确过期计划的 API 行为。
- 验收：每类对象都有“可删/受保护/未知”的判定及原因；无法解析引用时保守拒绝删除；所有受保护数据超出预算时报告而不强制删除，不承诺总磁盘必然低于配额。

完成证据：`retention.ts` 定义保护优先、TTL/数量/容量规则和 CURRENT/Journal 引用集合；CacheLeases 提供只读保护检查；30 天过期计划 apply 返回 PLAN_STALE。新增策略、双 revision、过期 apply 与租约回归共 7 项通过，架构边界检查通过。协议见 `maintenance-retention.zh-CN.md`。

### C02 — plans/restore 回收预览

- [x] 完成；PR 08；前置：C01。
- 范围：维护请求/CLI、缓存枚举、预览保存。
- 工作/交付：列出路径、对象类型、大小、保留/回收原因及输入指纹；仅纳入归属可识别、无引用且过期的对象。
- 验收：预览不删除资源；未知文件和用户 quarantine 保留；准备任务与有效计划引用正确展示为受保护。

完成证据：新增 SDK planMaintenance 与 maintenance --dry-run CLI，保存带摘要和对象指纹的预览；新 prepared/restore 目录携带归属记录，未知/历史未标记目录保留。预览及 C01/租约回归 10 项通过，架构边界检查通过。

### C03 — 可恢复回收执行

- [x] 完成；PR 08；前置：C02。
- 范围：维护执行、租约协议、隔离与清理记录。
- 工作/交付：在约定锁顺序下重验候选与引用，再隔离和删除；与消费者获取租约形成互斥协议；建立足够的持久恢复证据。
- 验收：计划后新增引用或路径身份变化时拒绝/要求重规划，不扩大删除范围；消费者不会读到被删除的输入；隔离/部分删除时 SIGKILL 可恢复。

完成证据：applyMaintenance/recoverMaintenance 及 CLI 采用 Home→cache guard 锁序、完整预览复核、持久日志、隔离和逐项指纹核验删除；过期同根计划引用在日志内退休，跨根引用保留。四个真实 SIGKILL 点及外部隔离文件冲突测试通过；npm run check 通过（257/257 快速测试、架构/构建/发布源检查）。

### C04 — 来源与插件缓存保留

- [x] 完成；PR 09；前置：C03；与 B 升级集成时依赖 B04、B07。
- 范围：SourceManager 缓存、catalog、插件签名缓存、候选与计划引用。
- 工作/交付：保留活动、选中和已授权有效计划所需快照/插件；只清理无引用对象；纳入升级候选的租约和过期规则。
- 验收：维护后 search/info/install/repair 及有效升级计划按承诺可用；不因“可下载”删除当前必须的数据；离线测试不依赖网络补救误删。

完成证据：来源快照与插件缓存静态身份校验、CURRENT/catalog/repair/有效候选引用保护接入维护；过期无引用候选可回收。离线 search/info/install/restore repair 和有效升级 apply 通过；维护预览/执行/真实崩溃回归共 12 项通过，架构检查通过。

### C05 — revisions 保留与维护验收

- [x] 完成；PR 09；前置：C03、C04。
- 范围：`storage/state-store.ts`、Journal 引用、维护策略和测试。
- 工作/交付：实现版本数/期限保留、保护 CURRENT 和 before/next revision；明确历史审计快照与恢复备份的差别；完成长期循环安装/升级/维护 fixture。
- 验收：当前状态及待恢复事务始终可读/可恢复；保留规则可解释；用户修改隔离副本不受普通 TTL 清理；长期 fixture 中可回收部分不会无限增长。

完成证据：revision 与维护预览按类保留、CURRENT/有效计划 baseRevision 保护、Home Journal 阻断和同文件系统 revision 隔离恢复已实现。五轮真实 install/upgrade/maintenance fixture 验证可回收对象收敛及用户 quarantine 保留；维护线 14 项联合回归通过，新增 revision 隔离恢复与其余 revision 测试 3 项通过，架构检查通过。

### C06 — 操作选项与结构化结果契约

- [ ] 完成；PR 10；前置：A02、A06；升级结果与 B02/B07 的契约对齐。
- 范围：`application/types.ts`、`index.ts`、CLI JSON 契约及版本说明。
- 工作/交付：固定 signal/timeout/onProgress 参数、阶段事件、判别联合变更与 committed/maintenance 状态；定义超时从调用开始计算，恢复收尾可超出期限；定义 close 行为。
- 验收：现有调用按兼容策略可用；回调/signal 不进入保存计划或 request digest；调用方不解析自然语言即可判断是否提交、是否需要恢复。

### C07 — 准备阶段与锁等待取消

- [ ] 完成；PR 10；前置：C06、A08。
- 范围：GitClient、SourceManager、文件锁等待、准备资源释放。
- 工作/交付：统一传播取消与剩余时间预算；清理当前任务拥有的临时资源和租约；停止启动后续准备工作。
- 验收：提前取消、Git 进行中、锁等待中均可终止；不删除其他进程锁或有效计划引用；无遗留子进程；同步或不可中断工作只在明确定义的检查点响应。

### C08 — 写事务取消与 close 生命周期

- [ ] 完成；PR 10；前置：C07、A09。
- 范围：Application 活跃操作登记、协调器安全检查点、close。
- 工作/交付：提交前取消进入安全回滚；恢复/回滚不继承已取消 signal；committed 后返回已提交结果；close 拒绝新请求并等待已接受请求结束，重复调用幂等。
- 验收：取消与提交竞争、回滚中再次取消、重复 close、close 与新请求竞争均确定；遇到恢复冲突仍保留证据；不得把已提交结果报告成普通取消失败。

### C09 — 进度与 CLI/SDK 集成

- [ ] 完成；PR 10；前置：C06、C08。
- 范围：内部 observer 到公共事件的映射、CLI stderr、JSON 输出、类型测试。
- 工作/交付：输出稳定阶段与计数，隔离 observer 异常；集成结构化变更与维护状态；更新 SDK 和中英文 CLI 示例。
- 验收：事件顺序及最终结果一致；JSON stdout 仅一份文档；回调抛错不触发回滚；不泄漏文件正文和凭据；类型消费者可穷尽处理联合结果。

### C10 — 发布 C 候选验收

- [ ] 完成；PR 09/10 收口；前置：B10、C05、C09。
- 范围：维护/升级/取消组合测试、跨平台发布与真实 runtime 验收。
- 工作/交付：组合验证“准备升级时维护”“apply 时取消”“提交后清理失败”“close 时仍有租约”等场景；执行全部发布 gate。
- 验收：同一候选包通过验证；有效计划/运行中任务不受 GC 破坏；取消不改变提交点含义；限制与保留策略写入发布文档。

## 推荐推进顺序

先完成 A01；随后 A02/A03 可独立推进。A04–A12 按依赖顺序完成，发布 A 是首个验收里程碑。

批次 B 先完成 B01–B05 的手动升级闭环，再集成 B06–B09 的 Bundle 与格式工作。B08 的格式设计必须提前落定，不能等事务实现完成后再补。

批次 C 的维护线 C01–C05 与 SDK 线 C06–C09 可分别推进；统一接入 B 的候选/lock 数据模型，并在 C10 做组合验收。这里的并行指任务依赖允许，不要求增加开发者或启动其他代理。

## 完成证据模板

每个任务完成时在相应条目下追加：

```text
实现：commit 或 PR 链接
验证：命令、结果、专项场景
文档：变更文档路径
限制：剩余限制，或“无”
发布任务附加：候选包 SHA-256、平台报告、真实 Codex preflight 报告
```
