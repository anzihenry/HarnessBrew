# 阶段 5：Executor、Journal 与事务恢复

日期：2026-10-02。依据：[架构决策](refactor-architecture.zh-CN.md)、[数据契约](refactor-contracts.zh-CN.md)、[验收矩阵](refactor-acceptance.zh-CN.md)。

## 1. 已实现范围

| 模块 | 职责 |
| --- | --- |
| `src/execution/validate.ts` | 写入前复核计划、能力、源库存、目标边界、归属与文件合并载荷，不重新调用 Adapter 渲染 |
| `src/execution/content.ts` | 按固定库存构造隔离内容目录，验证字节/权限/摘要，刷新文件和目录后发布 |
| `src/execution/files.ts` | 原始字节 before image、链接及权限记录、原子替换与目录同步 |
| `src/execution/state.ts` | 检查实际资源 fingerprint，构造新的来源/要求/操作/安装快照 |
| `src/transactions/journal.ts` | 版本化 Journal、校验摘要、原子写入及损坏时拒绝自动恢复 |
| `src/transactions/coordinator.ts` | 锁顺序、完整操作上下文、联合提交、逆序恢复与故障点 |
| `src/storage/state-store.ts` | 新增事务内有效的独占 lease，复用同一 Home 锁发布或恢复 CURRENT |

Executor 不包含资产 kind 分支，不解析依赖，也不决定升级版本。输入来自宿主生成的 ChangePlan；未增加接受外部操作 JSON 的 CLI/SDK 入口。

计划补充 `userHome`，让执行器使用规划时的用户根复核 Adapter 授权路径。执行器检查逻辑操作和文件更新组的载荷一致性，避免把计划摘要检查当成唯一验证。

## 2. 操作入口与锁

内部入口：

- `execute(build)`：先锁定并恢复，再把最新状态交给回调生成完整计划，随后执行。
- `apply(input)`：应用已有计划，核对 Home、revision、Adapter 与目标前置条件，不隐式重新规划。
- `withSession(action)`：业务组合复用同一事务上下文和锁；每次 apply 是一个独立提交边界。要原子改变多个要求，应合成一个 DesiredState/ChangePlan。
- `read()`：在 Home 写锁保护下读取；遇到 Journal 返回 `RECOVERY_REQUIRED`，不会把中间 CURRENT 当作可供业务使用的成功状态。
- `recover()`：在同一锁顺序下恢复或完成已提交事务的清理。

顺序为 **Home `.store.lock` → 同用户外部写锁 → 排序后的目标/lockfile 锁**。用户级外部锁默认位于系统临时目录的 `harnessbrew-transactions-<uid>`；测试可以注入独立 lockRoot，正常应用中的所有 Home 必须使用同一默认锁根。

同 Home 的查询等待写入完成；不同 Home 的共享文件写入也串行化。业务辅助函数在 `withSession` 内复用上下文，不再次获取不可重入的 Home 锁；执行进行中禁止递归 apply。跨 Home 的嵌套事务被明确拒绝。

StateStore 的普通 `commit()` 发现 Journal 会拒绝写入。原始 `read()` 仍允许读取 CURRENT，用于恢复诊断；应用查询应使用 Coordinator 的受保护读取。进程锁超时现在使用新领域错误码 `LOCK_TIMEOUT`。

## 3. 持久化与提交点

```text
<home>/
├── CURRENT
├── revisions/<revision>.json
├── content/<sha256>/              # 已验证的不可变资产内容
├── transaction.json               # 一次仅允许一个活动 Journal
└── .transaction-<id>/             # 本次操作的隔离内容暂存
```

1. 验证计划及当前归属；Bundle 操作还必须提供 lockfile 路径和预览时的前置条件。
2. 原子保存 `prepared` Journal，包含原状态与预定的新 revision。
3. 暂存并验证内容。内容目录按摘要复用；既有内容缺失或被修改时拒绝隐式修复。
4. 每个目录创建、内容发布、Target/lockfile 变更，先把 before image、预期结果、父路径身份和 `pending` 状态写入 Journal。
5. 核对当前值和父路径，执行操作，刷新磁盘，读取实际结果，再将实际 after image 和 `done` 状态持久化。
6. 所有内容先于 Target 准备完成。共享文件以更新组为单位原子替换，保留未受管内容；Bundle lockfile 与安装要求参加同一事务。
7. 提交前重新检查目标 fingerprint、内容库存、父路径和 Adapter 身份，保存完整候选状态到 Journal，发布新 revision/CURRENT。
8. 原子写入并同步 `committed` Journal，这是业务提交点。之后只做清理，清理失败返回成功结果和维护诊断。

文件 before image 保存原始字节、mode；链接保存原始链接文本；新目录记录实际设备/inode。Journal 文件权限为 0600。目标写入使用同目录临时文件加 rename，并同步目录；新目录及内容发布同样同步父目录。

重复应用且状态/资源均未变化时，不生成新 revision。释放要求只移除对应投放并将无引用内容标记 orphan；孤立内容的显式 cleanup 命令由阶段 6 应用层接入。正常移除暂保留曾创建的空父目录，不把目录路径字符串当成永久删除授权；失败回滚只移除本次创建且身份仍可验证的空目录。

## 4. 恢复规则

- **未提交**：逆序处理步骤，恢复 Target/lockfile before image，撤销本次新内容和可验证的新目录，最后恢复原 CURRENT。
- **已提交**：要求 CURRENT 与 Journal 中的已提交状态一致，只清理事务缓存和 Journal，绝不撤销已提交安装。
- **CURRENT 已发布、commit 标记尚未持久化**：仍按未提交事务恢复旧状态。
- **写入已发生、after image 尚未记录便中断**：如果实际值已经不是 before image，返回恢复冲突；不凭“看起来等于预期值”猜测归属。
- **外部用户修改**：只有当前值匹配 before 或已记录 after，才允许继续恢复。父目录身份变化、陌生临时资源、非空新目录、内容被修改等情况保留现场。
- **恢复再次中断**：每步记录 `reverting/reverted`，重启后允许继续；已经恢复成 before image 的步骤不会重复破坏用户内容。
- **原操作和恢复同时失败**：返回 `RECOVERY_REQUIRED`，cause 中的 AggregateError 同时保留两个错误。后续写入会先尝试恢复；仍无法证明归属时继续受阻。
- **Journal 损坏或状态证据不一致**：保留文件并拒绝自动覆盖，等待显式处理。

缓存与锁协调不是多文件的对外原子切换。外部 Agent 仍可能在事务中看到中间内容；不遵循这些锁的程序也不在互斥保证范围内。阶段 6 将把这里的恢复错误与诊断映射到用户入口。

## 5. 验收与后续边界

- A05：已有 B 链接，安装依赖 B 的 A 在后续步骤失败，B 的原内容、链接和要求完整保留。
- B10：Bundle lockfile 与要求一起提交/恢复；恢复时发现外部修改的 lockfile 不覆盖。
- T02/T03：真实子进程在 prepared、目标已记录、状态已发布、未记录写入和 committed 处 SIGKILL，分别验证旧状态恢复、冲突保留和成功提交保留。
- T04：错误与恢复错误同时保留；Journal 阻止普通状态写入和业务读取。
- T05/T06：共享外部锁、两个 Home 保留彼此配置键、目标父路径被替换时不向替换路径写入。
- T07/T08：上下文复用、查询保护，以及恢复前拒绝报告普通业务状态。
- 执行六类 Codex 资产，检查真实目标与状态；重复应用不生成新 revision；操作结果通过实际 fingerprint 验证。

阶段 5 已提供新后端执行链路，旧 CLI/SDK 尚未切换。旧入口 A02/A03/A05 仍有 3 个 TODO；A05 现在另有新事务链路的通过测试。应用服务、所有 CLI/SDK 命令、Doctor、保存计划和用户可见恢复流程仍属于阶段 6，不在本阶段宣称完成。

## 6. 本次本地验证

- `npm run check:all` 退出码 0：严格构建与发布元数据校验通过；快速套件 206 项通过；打包套件 19 项通过；旧入口 3 项 TODO 单列。
- 收尾统一锁超时错误码，并加强父路径别名复用、目录/内容身份和恢复历史快照验证。新增 1 项历史快照被修改的回归测试后，重新编译完整源码与测试；执行、真实进程中断、State Store 和进程锁共 37 项复验全部通过。快速套件现累计 207 项，本次未重复运行未受影响的其他测试。
- 新事务链路有 26 项执行/恢复测试，其中 5 项使用 IPC 就绪信号后真实 SIGKILL；并发验证没有通过固定 sleep 猜测锁状态。
- `git diff --check` 通过。

环境为本机 macOS / Node 24；未执行远程 CI、真实断电测试或需要 Codex 凭据的 runtime preflight。文件与目录 fsync、原子 rename 的代码路径和进程中断已验证，不把进程中断测试描述为硬件掉电验证。
