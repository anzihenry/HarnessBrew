# 重构验收场景与阶段 1 完成清单

状态：设计验收规范。阶段 2 已实现部分领域与存储测试及 3 个 TODO 回归夹具，详见[实施记录](phase2-implementation.zh-CN.md)；阶段 3 已覆盖来源与解析语义，见[阶段 3 实施记录](phase3-implementation.zh-CN.md)。阶段 4 的规划层验收范围见[阶段 4 实施记录](phase4-implementation.zh-CN.md)。阶段 5 的执行与事务验收范围见[阶段 5 实施记录](phase5-implementation.zh-CN.md)。本矩阵不表示全部业务验收已通过。配套：[架构决策](refactor-architecture.zh-CN.md)、[接口契约](refactor-contracts.zh-CN.md)。

## 1. 场景矩阵

| ID | 场景 | 预期结果 | 主责 / 实施阶段 |
| --- | --- | --- | --- |
| A01 | A 依赖 B，安装 A | B、A 顺序安装；A 是根，B 由闭包引用；依赖继承 placement | Resolver / 3 |
| A02 | A 新版新增 B，upgrade A | B 一并安装；新闭包及所有投递一致 | Resolver / 3、业务 / 6 |
| A03 | A 新版与已安装 C 冲突 | 写入前返回 ASSET_CONFLICT；旧内容和要求保留 | Resolver / 3 |
| A04 | 缺失依赖、循环或双方任一侧声明冲突 | 所有入口使用相同错误码和定位信息 | Resolver / 3 |
| A05 | 原有 B 已链接；安装依赖 B 的 A，后续失败 | B 的原要求、链接和内容全部保留 | 事务 / 5 |
| A06 | 不同 Tap 含同名资产 | 所有命令一致拒绝短名称歧义，返回候选坐标 | Catalog / 3 |
| A07 | 重复相同 install/apply | 无多余复制、Target 写入或重复操作；只有实际变化才发布新 revision | Planner / 4 |
| B01 | 两个 Bundle 共用相同版本及 placement | 一份活动内容和一份物理投递，多份使用者引用 | 状态 / 2、Planner / 4 |
| B02 | A 删除共享资产要求，B 仍引用 | A 的要求消失，物理资源及 B 的要求不变 | Planner / 4 |
| B03 | Bundle 改为另一 project placement | 释放旧要求、创建新投递；其他使用者仍引用旧投递时保留 | Planner / 4 |
| B04 | 两个使用者锁定同坐标不同版本 | VERSION_CONFLICT；不修改另一方锁或安装 | Resolver / 3 |
| B05 | manual remove 的资产仍是其他根依赖 | 释放 manual 根要求，保留活动内容并返回 retained 原因 | Resolver / 3 |
| B06 | 最后一个要求释放，然后 cleanup | 投递在释放时删除；内容先 orphan，cleanup 后回收；被修改内容拒绝删除 | Planner / 4、业务 / 6 |
| B07 | 相同 manifest 在两个 checkout apply | 生成两个本机 binding；detach 任一绑定不影响另一个 | 应用 / 6 |
| B08 | Manifest 移动、丢失或 id 变化 | 不自动接管旧绑定；可按 binding 显式 detach | 应用 / 6 |
| B09 | Bundle lock 过期、Adapter 签名变化 | 默认 LOCK_MISMATCH/ADAPTER_CHANGED；显式 update-lock 才重新解析 | Planner / 4 |
| B10 | 一次 apply 同时修改 lock 和多个安装，后续失败 | lock 与安装要求一起恢复；外部 lock 被修改则恢复冲突，不覆盖 | 事务 / 5 |
| C01 | Codex skill/agent/workflow/prompt/instruction/MCP | Adapter 生成完整操作；Executor 无资产 kind 分支 | Adapter / 4 |
| C02 | 一个 placement 生成多个操作 | 可完整执行、诊断、移除及恢复，每条都有归属记录 | Adapter / 4、执行 / 5 |
| C03 | 非法源路径、目标逃逸、未授权操作能力 | 计划校验失败，执行器未写入 | Planner / 4 |
| C04 | 同一共享文件两个不同键/区块 | 同一次文件更新，保存独立所有权，不损坏用户内容与注释 | Planner / 4、执行 / 5 |
| C05 | 同路径独占与共享所有权、键祖先/后代冲突 | OWNERSHIP_CONFLICT，无写入 | Planner / 4 |
| C06 | Plugin 在 plan 后发生内容变化 | apply-plan 返回 PLAN_STALE/ADAPTER_CHANGED，不导入漂移代码 | 应用 / 5、6 |
| C07 | 删除有活动 placement 的 Adapter | ADAPTER_IN_USE，安装和注册状态不变 | 应用 / 6 |
| T01 | CLI 与 SDK 执行相同请求及故障注入 | 同等状态和错误码；SDK 自动获得锁与恢复保障 | 应用 / 5、6 |
| T02 | 写内容、写 Target、发布状态、提交前后分别中断 | 未提交恢复旧状态；已提交保留新状态；不因清理失败丢失成功提交 | 事务 / 5 |
| T03 | 写后未记录 fingerprint 即崩溃 | 无法验证时 RECOVERY_CONFLICT，保留备份与目标供处理 | 事务 / 5 |
| T04 | 原操作失败且恢复也失败 | 同时保留两个错误，后续 Home 写入受阻 | 事务 / 5 |
| T05 | 两个 Home 同时操作共享配置文件 | 锁覆盖整次相关变更；已提交用户/另一 Home 内容不会被回滚覆盖 | 事务 / 5 |
| T06 | 目录与子文件操作、路径别名并发 | 用户级外部写事务锁防止相互覆盖；父路径替换检测有效 | 事务 / 5 |
| T07 | 已持有事务的内部业务组合 | 复用上下文，不嵌套获取不可重入锁；无死锁 | 应用 / 5 |
| T08 | 写入进行时 query/doctor | 等待一致状态；未完成事务明确诊断，不报告伪健康 | State Store / 2、事务 / 5 |
| P01 | 对 install、upgrade、bundle 预览 | 不改变活动内容、安装状态、信任、锁文件和 Target；可写隔离缓存 | 预览 / 6 |
| P02 | 预览包含共享配置合并 | changes 有真实 before/after 摘要和资源级原因，与执行一致 | Planner / 4、预览 / 6 |
| P03 | 预览后用户修改文件或状态 revision 改变 | apply-plan 返回 PLAN_STALE，不隐式重新计划 | 应用 / 6 |
| P04 | 预览遇到未完成事务 | RECOVERY_REQUIRED，不自动执行恢复写入 | 预览 / 6 |
| P05 | 新插件 add 预览 | 不执行未授权插件代码；显示需在授权执行时验证的项目 | 插件 / 6 |
| D01 | 文件完好但依赖缺失或有冲突 | doctor 不健康，dependency 分类明确定位 | Doctor / 6 |
| D02 | 一条记录损坏，其他资产也有问题 | 输出状态损坏和可继续检查到的问题，不伪造完整检查成功 | Doctor / 6 |
| D03 | Target 缺失 / 用户修改 / Cellar 损坏 | 区分 findings；repair 默认只修缺失；明确归属后才允许 overwrite-owned | Doctor / 6 |
| D04 | 撤销信任后 repair、upgrade 投递、unlink | 前两者拒绝激活；清理仍允许 | 应用 / 6 |
| F01 | 打开旧状态或旧 manifest/plugin | 明确 UNSUPPORTED_FORMAT/协议错误，不转换、不删除、不覆盖 | Storage / 2、Adapter / 4 |
| F02 | 新 Home 遇到旧版本遗留 Target | 视为未受管内容，冲突退出，不自动接管 | Planner / 4 |
| F03 | JSON 模式成功、失败、doctor 不健康 | stdout 一个版本化对象；退出码、code、报告符合契约 | CLI / 6 |
| F04 | 两台机器应用同一可移植锁 | 来源和内容摘要一致；本机路径与 binding 可以不同且不写回锁 | 集成 / 7 |

## 2. 实施与验证方式

- 阶段 2：模型校验及状态测试，建立 A02/A03/A05 回归夹具；新架构未接入前允许作为明确的待实现测试，但不能混入已通过统计。
- 阶段 3～4：使用确定的来源/状态快照测试 Resolver/Planner，断言最终语义、所有权与操作，不绑定私有函数拆分。
- 阶段 5：真实临时目录、多进程互斥、可控故障点与进程中断测试；进程协调使用 ready 信号，禁止靠固定 sleep 推断先后。
- 阶段 6：同一场景分别通过 CLI/SDK 执行并比较结果；覆盖所有资产类型、user/project 与多 placement。
- 阶段 7：候选包只构建一次，在 Linux/macOS 运行打包场景；真实 Codex runtime 验证单独报告，缺失环境不能冒充通过。
- 性能基准分开测量来源准备、解析、预览和执行；没有测量结果时不承诺提速比例。

## 3. 阶段 1 完成定义

本阶段交付的是后续实现依据，下列勾选不表示对应功能已经实现。

- [x] 确定核心模型和状态不变量。
- [x] 明确角色输入输出、责任与依赖方向。
- [x] 决定单 Home 单坐标活动版本及版本冲突策略。
- [x] 定义 Bundle 身份、共享引用、detach 和 cleanup 范围。
- [x] 明确命令读取、改变、保留和失败语义。
- [x] 定义事务提交点、锁顺序、中断恢复与外部可见性边界。
- [x] 定义预览、保存计划和执行时的过期检查。
- [x] 定义 SDK、CLI JSON、错误码、磁盘格式和 Adapter 协议。
- [x] 明确取消兼容但不自动处理旧用户数据。
- [x] 将设计转为可追踪的后续验收场景。

阶段 2 可直接开始实现 domain/storage 和测试基线，无需再决定上述业务边界。配置 codec 库选型、锁底层实现、缓存回收预算属于后续实现选择，须满足本契约；若无法满足，应先修订决策及相关场景，再改变行为。
