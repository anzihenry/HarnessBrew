# 重构架构决策：统一状态规划与事务执行

- 日期：2026-10-01
- 状态：阶段 1 设计基线，待后续阶段实现
- 范围：下一代 HarnessBrew 内部架构、CLI、SDK、Adapter 与磁盘格式
- 配套：[接口与数据契约](refactor-contracts.zh-CN.md)、[验收场景](refactor-acceptance.zh-CN.md)

本文描述目标设计，不代表当前 0.8.0 已实现。现有行为说明仍见 [当前架构](../architecture.zh-CN.md)。本次只落实设计，不修改业务实现。

## 1. 目标与边界

统一主链路：请求 → 来源/安装快照 → 依赖解析 → 期望状态 → 差异计划 → 平台操作 → 执行 → 提交安装状态。

继续使用单个 npm 包、TypeScript、Git 来源和本地文件存储。取消旧 API、CLI 别名、Receipt、Harnessfile、lockfile 和 Adapter SDK 的兼容要求；不建立兼容层。不增加依赖版本范围求解、远程服务或数据库。资产依赖仍为完整坐标，版本由来源快照和环境锁定结果确定。

核心不变量：

1. 一个 Home 中，每个资产坐标最多有一个活动版本；不同坐标可引用同一 Tap 的不同 commit。
2. 已提交安装集合的依赖完整、无循环、无双向冲突。
3. 每个活动投递都对应存在且完整的资产内容。
4. 每个可写资源的所有权唯一；资源指完整路径、配置键或受管区块。
5. 安装要求与物理资源所有权分开：多个使用者可以要求同一个投递，物理操作只执行一次。
6. 成功结果只能在事务提交后输出；失败不得撤销本次操作前有效的安装要求和资源。
7. 重复应用相同请求不会产生不必要写入。
8. 预览不修改活动安装、信任授权、Receipt、lockfile 或 Agent Target。
9. 受管文件在规划后被外部修改时，执行失败并报告前置条件变化，不自动覆盖。
10. Formula 是数据，不加载 Tap 中的代码；Adapter 是用户显式授权的宿主代码，其权限校验不构成进程沙箱。

## 2. 责任角色与依赖方向

| 角色 | 输入 → 输出 | 负责 | 边界 |
| --- | --- | --- | --- |
| Application Service | ChangeRequest → Preview/ExecutionResult | 一次完整操作、上下文、协调事务 | 不实现依赖遍历或平台渲染 |
| Source Manager | 来源/ref/commit → SourceSnapshot | Git 获取、固定内容、快照缓存、连续性检查 | 不改安装记录或 Target |
| Catalog | SourceSnapshot → AssetManifest/ResolvedAsset | 声明读取、资产格式校验、索引 | 不决定升级范围 |
| Resolver | 请求、来源与当前状态 → DesiredState | 闭包、循环、冲突、反向依赖、跨使用者版本约束 | 不写文件 |
| Planner | 当前/期望状态 → ChangePlan | 差异、顺序、前置条件、所有权冲突、原因 | 不执行计划 |
| Adapter | 只读资产视图、placement → 平台操作列表 | 路径、格式、渲染、适用性 | 不写 Target、Git 或状态 |
| Executor | 已验证计划 → AppliedOperation[] | 操作级校验、写入、临时资源清理 | 不解析依赖或决定升级版本 |
| State Store | 已验证数据 ↔ 持久化状态 | Schema 校验、原子状态发布 | 不决定业务语义 |
| Transaction Coordinator | 计划、执行动作 → 提交/恢复 | 锁、Journal、持久化次序、故障恢复 | 不包含平台判断 |
| Doctor | 状态与内容 → 分组诊断 | 内容、投递、依赖、所有权一致性 | 不自动修复 |

CLI 和 SDK 只调用应用服务。application 依赖各能力接口；resolution/planning 依赖 domain，不依赖 CLI、Git 子进程或持久化实现。具体 Source、Store、Adapter 在应用实例创建时组装。

建议目录：`src/domain`、`application`、`sources`、`catalog`、`resolution`、`planning`、`adapters`、`execution`、`storage`、`transactions`、`diagnostics`、`cli`。目录表达责任，不要求每个角色都是类。

## 3. 安装要求与 Bundle 管理范围

### 3.1 两种使用者

- `manual`：该 Home 的手动安装要求，用户明确 install 的资产是根要求。
- `bundle:<id>@<binding>`：一个 Bundle 在本机的绑定。Harnessfile 必须声明稳定 `id`；binding 为应用服务根据规范化 manifest 目录生成的本机标识。同一仓库的不同 checkout 默认独立管理。

状态记录每个使用者的根资产、解析后的依赖闭包、精确版本要求和 placements。不能只用全局 `requested: boolean` 表达要求。

Bundle 标识不能赋予删除任意路径的权限。删除必须从该绑定的既有要求和已记录的受管操作推导；移动 manifest 不自动接管旧绑定。显式 `bundle detach --binding <id>` 释放旧绑定，无须旧 manifest 存在。

### 3.2 共享资源

多个使用者对同一坐标要求相同版本时，共享活动安装。对相同 placement 生成相同操作时，共享投递，记录多个使用者引用。

若 A 与 B 的精确版本要求不一致，返回 `VERSION_CONFLICT`，不悄悄升级另一方。用户需更新冲突使用者的声明/锁并显式 apply。当前版本不支持同一 Home 多版本并存或跨多个 Bundle 的原子联合更新；需要不兼容版本时使用独立 Home。

每个 Bundle 的 lock 固定其完整闭包。manual upgrade 也必须尊重其他使用者的锁定要求。单个 manual 内的多个根共享版本选择，升级时重新验证整个 manual 集合及其他使用者的约束。

### 3.3 清理策略

`bundle apply` 精确替换该绑定的要求：删掉 manifest 中已移除的根及 placement 要求，更新依赖闭包；其他使用者的要求保留。最后一个 placement 引用释放时，移除对应受管操作。

无任何使用者需要的资产标记为 orphan，可暂留 Cellar；默认 apply/upgrade/remove 不删除其内容。`cleanup` 单独移除 orphan 内容和相关库存记录，不释放任何仍有效的使用者要求。orphan 不参与活动依赖/冲突检查，也不能保留活动投递。

## 4. 命令语义

所有变更命令先构造最终状态、完整校验，再执行。错误默认保持此前已提交状态。

| 命令 | 读取 | 改变 | 保留与失败条件 |
| --- | --- | --- | --- |
| `tap add/update/remove` | 来源配置与快照 | 来源注册、候选快照 | 不自动升级安装；被使用者引用的 Tap 不可删除；update 默认拒绝 rewind |
| `tap trust/untrust` | 来源授权 | Home 级信任状态 | 不由 Harnessfile 隐式提升信任；撤销后不自动删除旧投递，允许清理，阻止新增/更新/修复投递 |
| `install <asset> [placement]` | catalog、全部要求 | 添加 manual 根及依赖、placement；已存在根增加 placement | 已安装版本默认复用，版本变化使用 upgrade；新依赖投递继承根 placement |
| `upgrade [asset]` | manual 根、最新来源快照、其他使用者约束 | 更新选定 manual 根的闭包和投递内容 | 不隐式修改 Bundle；指定非 manual 根返回使用者信息；省略参数更新全部 manual 根 |
| `remove <asset>` | manual 要求与反向依赖 | 释放 manual 根及其 placement 要求 | 其他根或 Bundle 仍需要时保留资源，并返回 retained 原因；非 manual 根不可用此命令移除 |
| `link/unlink <asset> <placement>` | manual 根与闭包 | 增加/释放该根的 placement 要求，依赖继承 | 不编辑 Bundle 声明；其他引用保留；缺少 scope 且多实例时拒绝歧义 |
| `bundle apply --file <path> [--update-lock]` | manifest、lock、绑定及其他使用者 | 替换该绑定的完整要求，提交锁与安装状态 | 有锁默认严格使用；声明或 Adapter 内容签名变化须显式 update-lock；首次无锁生成新锁 |
| `bundle detach --binding <id>` | 绑定记录 | 释放该绑定全部要求 | 保留其他使用者引用，资产内容由 cleanup 回收 |
| `cleanup` | 安装要求、内容库存 | 删除 orphan 内容与记录 | 不删除被引用内容；内容被修改时拒绝清理并报告 |
| `repair <asset> [placement]` | 实际记录、内容摘要、来源信任 | 重建缺失的受管操作 | 默认不覆盖被修改的资源；`--overwrite-owned` 仅允许替换能验证归属的文件/区块/键，不接管未知文件 |
| `doctor [asset]` | 状态、库存、目标 | 无 | 返回分组问题；损坏记录尽量定位到单项，不让一个坏记录掩盖其余检查 |
| `list/search/info/outdated` | 已提交快照或来源缓存 | 无 | 返回版本及使用者；outdated 分别报告 manual/Bundle，不等同于允许升级 |

不保留 `uninstall`、`relink`、`bundle install` 等旧别名。具体参数语法见契约文档。

版本连续性是 Source Manager 的规则；信任是应用服务的授权规则；内容适用性是 Catalog/Adapter 的规则；共享约束由 Resolver/Planner 统一判断。

## 5. 内容与平台模型

资产内容存放于按摘要定位的不可变内容目录，活动安装记录引用内容摘要与来源 commit。执行权限和相对路径进入内容摘要；目录顺序按确定的字节顺序规范化。禁止逃逸资产根的路径及未支持的特殊文件；首版资产库存拒绝符号链接。

不同内容使用不同目录。相同内容无需重复复制。Tap 无关提交导致 commit 变化但内容摘要相同，可只更新来源记录；Adapter 操作摘要没有变化则不重写 Target。

Adapter 接收 `AssetView`，包含坐标、类型、声明、只读内容访问和摘要，以及解析后的 placement；不接收可修改的安装记录。允许一个 placement 返回多个操作。

操作包括目录链接、文件链接、受管文件、受管区块和受管配置键。配置键使用结构化路径，禁止原型污染键；区块使用稳定 marker。共享文件中整文件所有权与键/区块所有权互斥。相同键、祖先/后代键以及重叠目录所有权冲突必须拒绝。

内置与第三方使用同一协议和验证器。插件声明所需能力，用户显式授权；注册配置记录授权能力及内容签名。首版第三方只可请求链接能力；内置 Codex 授予所需渲染/共享编辑能力。未知能力和未获授权操作拒绝执行。插件签名覆盖受管插件包文件清单及锁定依赖；仍不将其描述为沙箱或任意宿主行为的完整性保证。

## 6. 事务和并发保证

### 6.1 操作阶段

1. Source Manager 可在隔离缓存准备不可变快照；该阶段不修改活动来源选择、安装和信任。
2. 应用服务获取 Home 写锁，在读取可写状态前恢复未完成事务。
3. 固定状态 revision 和来源快照，解析并生成完整计划。
4. 获取同一 OS 用户共享的外部写事务锁，再按规范化锁键排序获取目标及 lockfile 锁，验证目标前置条件。
5. 持久化恢复日志和 before image 后执行变更，逐步记录 after fingerprint。
6. 持久化新状态与外部 lockfile，刷新所需文件/目录，再持久化提交标记。
7. 发布成功结果，释放锁；备份清理失败不撤销已提交事务，记录维护诊断。

Home 锁在完整变更期间持有；所有变更遵守 Home → 用户级外部写事务锁 → 排序后的外部资源锁顺序。业务内部组合使用同一个操作上下文，不重新进入公共写入口。Target 锁跨 Home 生效，键由真实既有父路径加规范化剩余路径计算，避免符号路径别名绕过锁。

首版使用用户级外部写事务锁串行化同一 OS 用户所有 Home 的 Target/外部 lockfile 写入及恢复，从而覆盖目录与子路径冲突。锁不放在单个 Home 内，备份、校验、执行与恢复均在持锁期间完成。叶路径锁用于明确资源范围，但不能替代该总锁。以后可按基准改为分层并发锁，前提是继续满足同一语义。执行期间再次验证父路径未被替换为符号链接。不同 OS 用户及不遵守协议的程序不在互斥保证范围内。

### 6.2 恢复与可见性

事务状态：`prepared → applying → committed`；失败进入 `rolling-back → rolled-back`，无法安全恢复进入 `recovery-required`。

- 没有 durable commit 标记：下次写操作先恢复 before state。
- 有 commit 标记：保留新状态，只清理残余备份。
- 回滚检查与恢复在同一组锁内完成；当前值必须匹配 original 或记录的 after fingerprint。
- 若写入与记录 after fingerprint 之间崩溃，不能证明归属的变化返回 `RECOVERY_CONFLICT`，保留证据并阻止该 Home 后续写入。
- 恢复失败同时返回原始失败与恢复失败，不能覆盖原始错误。
- 外部用户修改或不遵守锁的程序修改，不能承诺自动恢复；优先保留其内容并报告冲突。

保证是持久化后的业务一致性和可恢复性，不承诺多个目标文件对外部 Agent 同时切换。共享文件使用临时文件加 rename 减少半写可见性。目标文件在事务期间可能短暂呈现中间状态。

State Store 用 revision 化的完整状态快照及原子 CURRENT 指针发布 Home 状态；快照统一包含来源、授权、插件与安装状态，可由多个带摘要文件组成，但只能由一个指针发布，避免多份记录部分提交。读取服务获取 Home 读保护（首版可复用互斥锁），写操作完成后才读取；发现未完成事务时只读命令报告 `RECOVERY_REQUIRED`，不返回伪健康结果。Doctor 可读取最后提交的状态用于恢复诊断。

## 7. 预览与执行

`plan(request)` 在快照上生成可序列化计划，不进入活动 Target 写事务；可填充隔离来源缓存，返回缓存活动说明。预览读取目标并计算真实合并结果、摘要与冲突，不能只列路径。

`execute(request)` 在事务保护下重新规划并执行。`apply(planId)` 验证状态 revision、来源/插件签名和全部前置条件；任何变化返回 `PLAN_STALE`，不得自动用新计划替换用户看到的计划。持久化计划存储在应用拥有的缓存中；不直接信任外部提交的操作 JSON。

未完成事务阻止常规预览并要求显式 `recover` 或下一次变更执行恢复；预览自身不进行恢复写入。锁和缓存协调元数据不计为活动安装变更。

## 8. 交付边界

阶段 1 完成设计文档、接口定义说明、命令矩阵和验收场景，不实现新接口、不切换磁盘状态、不自动清理旧数据。

后续顺序：状态模型与测试 → Source/Resolver → Planner/Adapter → Executor/事务 → 全部入口/Doctor/Preview → 删除旧代码与交付验证。

下一阶段首先实现配套验收表中的模型校验及失败回归。Git 大仓库优化、依赖版本范围、多 Home 联合事务、多版本共存和完整插件沙箱不属于本轮实现范围。
