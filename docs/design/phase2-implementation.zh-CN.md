# 阶段 2：领域模型、状态存储与测试基线

日期：2026-10-01。依据：[架构决策](refactor-architecture.zh-CN.md)、[数据契约](refactor-contracts.zh-CN.md)、[验收矩阵](refactor-acceptance.zh-CN.md)。

## 1. 已实现范围

| 模块 | 实现 | 验证重点 |
| --- | --- | --- |
| `src/domain/identity.ts` | 坐标、摘要、SHA-1/SHA-256 Git ID、路径及名称歧义处理 | 非法路径、短名称歧义、Git 对象格式 |
| `src/domain/assets.ts` | AssetManifest、SourceSnapshot、ResolvedAsset、内容库存校验与摘要 | 目录父项、空目录、权限、重复路径、特殊文件拒绝 |
| `src/domain/placement.ts` | placement 规范化、Bundle binding 和根要求标识 | user/project 约束、不同 checkout 独立绑定 |
| `src/domain/state.ts` | 使用者、要求、安装、资源所有权及实际操作模型 | 闭包与版本一致性、共享引用、孤立记录和资源重叠 |
| `src/domain/home-state.ts`（阶段 3 从 storage 移入） | 将来源、授权、插件、安装状态组成一份 revision 快照 | 跨状态引用、来源版本及 Adapter 能力一致性 |
| `src/storage/state-store.ts` | 空 Home 初始化、快照校验、原子发布、revision 比较更新 | 不覆盖旧数据、不丢失并发更新、故障前后可读性 |
| `src/ports/io.ts` | 文件系统、Git 和存储故障注入边界 | 无须替换全局对象即可模拟 I/O 失败；Git 支持取消 |
| `src/transactions/file-lock.ts` | 抽出既有进程文件锁原语供新存储复用 | 独立进程互斥、故障后锁回收 |

旧业务入口目前继续运行旧安装流程；新模型和存储尚未接入 CLI，不自动迁移现有 Home，也没有发布新的公共 SDK。`src/core/locks.ts` 暂时只转出同一份锁实现，防止并行维护两套原语；旧入口及旧错误类型在后续应用服务迁移时收敛。

## 2. 状态发布协议

```text
<home>/
├── CURRENT                  # format/version/revision/快照摘要
├── revisions/
│   ├── <revision>.json      # 来源、授权、插件、安装的完整快照
│   └── ...
└── .store.lock/              # 写入时临时持有
```

- `initialize()` 只接受空 Home 或有效的新格式 Home；旧格式、非空未知目录不自动转换。
- `read()` 读取一次 CURRENT，并验证不可变快照摘要和全部引用；返回独立数据对象。
- `commit(expectedRevision, candidate)` 在写锁内比较 revision，落后写入返回 `PLAN_STALE`；相同规范化内容不生成新 revision。
- 提交先以独占创建写入新快照并同步文件/目录，再写入并同步临时 CURRENT，最后 rename 发布指针并同步 Home 目录。
- CURRENT 发布前失败，旧快照仍然完整可读。未发布的新快照保留但不会被读取；后续缓存清理可回收。
- CURRENT 发布后目录同步失败返回 `RECOVERY_REQUIRED`，明确可能已经发布，不虚假声明旧状态保持不变。
- 不自动删除未知或损坏状态。首次初始化中断且没有 CURRENT 时，下一次初始化会拒绝非空目录，保留证据，要求显式处理或使用新 Home。

这是 Home 元数据存储的原子发布能力，不是阶段 5 的完整业务事务：Target、lockfile、授权操作与 Home 状态的联合提交及 Journal 恢复仍待实现。底层 `read()` 可返回完整的旧或新快照；应用层写入保护、未完成事务检测和 Doctor 恢复诊断由阶段 5～6 接入。

当前只做 placement 的词法路径规范化；物理路径别名和父路径变化检查由后续 Planner/Executor 实现。Store 对自身 Home 的已有父目录别名归一化，拒绝符号链接 Home、CURRENT 或快照文件。

## 3. 模型细化

- `AppliedOperation.placementIds` 为非空列表，`requirementIds` 表示使用者/根要求引用。这样多个逻辑 placement 映射到同一物理操作时，无须复制资源所有权记录。契约文档已同步。
- 保留单坐标一个活动版本。每个要求的精确 commit/内容摘要必须与活动安装一致。
- 活动资产必须被要求引用；orphan 不能有活动投递。没有 placement 的 Cellar-only 安装有效。
- 每个要求保存精确依赖闭包。状态校验拒绝缺失依赖、循环、冲突、额外或缺少的 pin，保证存储不能接受内部不一致的快照。这是提交前验证，阶段 3 仍需实现请求到期望状态的解析和版本选择。
- 内容摘要基于规范排序的库存记录，文件记录包含字节摘要和权限，目录记录包含路径和权限；空目录进入摘要。符号链接和设备文件不进入新资产库存。
- 同一文件允许不同配置键或不同区块共享，独占路径、键祖先/后代和混合共享策略的冲突会被拒绝。语义格式解析与实际合并仍属于阶段 4～5。
- 来源注册可以移除已不再活动使用的 Tap；其 orphan 所需历史 snapshot 元数据仍保留。活动资产必须能引用注册来源。

## 4. 测试入口

| 命令 | 覆盖范围 |
| --- | --- |
| `npm test` / `npm run test:fast` | 新领域/状态测试及现有源码测试，不运行打包场景 |
| `npm run check` | 构建、快速测试、发布元数据校验 |
| `npm run test:packaged` | 构建一次候选包，运行打包、E2E、发布门禁及模拟 runtime 测试 |
| `npm run test:regressions` | 执行 A02/A03/A05，明确作为待接入的 TODO 场景报告 |
| `npm run check:all` | 以上完整组合；TODO 单列，不计入已通过测试 |

CI 的 packaged job 通过 `HARNESSBREW_TEST_CANDIDATE` 复用 candidate job 已构建的制品。每个测试获取候选文件的独立副本，篡改验证不会污染其他测试。直接独立运行单个打包测试时，fixture helper 可以自行构建；正常套件运行只构建一次。

测试进程并发限制为 2。锁测试通过 IPC 确认首进程已持锁、次进程确实因锁超时受阻后再释放，不依赖固定 sleep 猜测调度顺序。存储测试通过故障点和真实子进程 SIGKILL 验证 CURRENT 发布前中断的可读性。

## 5. 阶段验收状态

已覆盖状态层的 A04/A06、B01/B02/B04、C05、F01 等约束，以及 T02 的元数据发布子场景；不表示这些场景已经通过新业务入口完整实现。

A02（升级新增依赖）、A03（升级冲突）、A05（失败保留原有链接）已经有真实临时 Git 仓库和断言。它们针对旧入口仍会失败，使用 Node test 的 TODO 标记单独报告。后续替换入口时必须移除 TODO，不能将其长期当成可接受失败。

下一阶段：Source Manager 和统一 Resolver。随后才能把这些要求从“拒绝非法状态”变成“自动规划正确状态”，并由应用服务和 Executor 完成整个操作。

## 6. 本次本地验证

执行 `npm run check:all`：严格构建与发布元数据检查通过；快速套件 126 项通过；共享候选包的打包套件 19 项通过；已知业务回归套件 0 项通过、3 项 TODO，均复现预期缺陷。未把 TODO 计为修复完成。

本次在本机 macOS / Node 24 运行。Linux/macOS CI 已配置复用候选包；本地未执行远程 CI，也未执行需要真实 Codex 凭据的 runtime preflight。打包套件中的 runtime 验证使用测试 Adapter。
