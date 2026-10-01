# 阶段 4：Planner 与 Adapter

日期：2026-10-02。依据：[架构决策](refactor-architecture.zh-CN.md)、[数据契约](refactor-contracts.zh-CN.md)、[验收矩阵](refactor-acceptance.zh-CN.md)。

## 1. 已实现范围

| 模块 | 职责 |
| --- | --- |
| `src/domain/adapter.ts` | 新 Adapter 协议、只读 AssetView、投放根与操作载荷 |
| `src/domain/plan.ts` | ChangePlan、资源前置条件、逻辑操作、文件更新组、预期归属 |
| `src/domain/catalog-index.ts` | 从 resolution 移入 domain，供 Resolver 与 Planner 共用精确版本索引 |
| `src/adapters/registry.ts` | 应用实例内的显式 Adapter 注册、协议与授权能力检查 |
| `src/adapters/codex.ts`、`placement.ts` | Codex 路径策略与全部六类资产的内容渲染 |
| `src/planning/assets.ts`、`validate.ts` | 库存限定的内容读取，校验操作类型、能力、源与目标边界 |
| `src/planning/plan.ts` | 当前状态与 DesiredState 的差异、共享引用、所有权冲突、依赖顺序和文件更新组 |
| `src/planning/config.ts`、`resources.ts` | JSON/TOML 键及受管区块的读取、编辑、语义指纹 |
| `src/planning/preconditions.ts` | 校验计划摘要、Home/revision、Adapter 身份与目标前置条件 |
| `src/ports/planning.ts` | 只读文件观察、真实父路径身份、基于 Catalog 的资产读取 |

`planChange()` 只读取经注入的端口，不执行文件更新、不提交状态、不安装或导入插件。计划输出可序列化、递归冻结，ID 由规范化计划内容生成。平台路径和渲染保留在 Adapter；Planner 无资产 kind 分支。

## 2. 计划与归属

计划包含：

- Home 身份、基础 revision、请求与 DesiredState 摘要。
- 所引用的来源快照、执行过的 Adapter 身份与内容签名。
- 目标文件及路径别名的内容/权限前置条件、最近既有父目录的真实路径及设备/inode。
- 资产 install/update/reactivate/orphan 变化及原因。
- 按依赖排序的逻辑操作、跨文件更新组的依赖关系。
- 每个物理文件的一份 before/after，供预览展示与后续 Executor 执行。
- 新的预期操作引用，以及直接保留的已有操作。预期 fingerprint 不代表操作已经执行。

新增先依赖后根，释放先根后依赖。相同物理地址只有在资产、内容摘要、操作类型及载荷完全一致时才合并；合并后保存全部 placement 和 requirement 引用。不同资产不能接管彼此资源，即使生成内容相同也不例外。

`remove-owned` 仅从旧 AppliedOperation 推导，Adapter 不能生成删除操作。最后一个引用释放后计划删除相应投放，资产内容标记 orphan，留给后续 cleanup 回收。受管目标已经缺失时，释放归属不会创建空文件。

重复 install/apply 不产生多余文件更新。只改变引用或 Git commit、渲染结果相同时，更新元数据即可。版本改变且内容不同则重新生成操作，并保存被替换操作的 ID，供 Executor 保留目录创建记录等实际元数据。

## 3. Adapter 约束

新协议为 `harnessbrew.adapter/1`，不兼容旧数字 `apiVersion`。

- 输入只含声明、库存、摘要及 `readText()`；读取必须属于库存，字节摘要一致，文件模式和类型未变化。
- 一个 placement 可以生成多条操作。支持目录链接、文件链接、完整文件、HTML 注释区块、JSON/TOML 键。
- 返回值必须可序列化；类型、载荷、资源地址、源库存、目标根及授权能力由宿主验证。
- 第三方 Adapter 首版只授权 `link-directory` / `link-file`；默认根为 user/project 下的 `.<adapter-name>`，可由 placement 的显式 `rootOverride` 指定。注册后名称被固定，不受原对象后续改名影响。
- Codex 使用 `.agents/skills`、`.codex/agents`、`.codex/config.toml`；project instruction 使用项目根 `AGENTS.md`，user instruction 使用 `.codex/AGENTS.md`。
- skill 链接完整内容目录并验证根 `SKILL.md` 元数据；agent 渲染 TOML；workflow/prompt 渲染原生 skill；instruction 使用独立 marker；MCP 占有 `mcp_servers.<name>` 键，凭据字段只接受环境变量引用。
- Adapter registry 为实例私有；注册只接收已授权对象，不执行 npm install 或动态模块导入。签名由调用方提供，并与本地注册状态比较；插件文件签名计算和加载生命周期由阶段 6 应用服务接入。这里不宣称签名比较能够隔离任意宿主代码。

## 4. 配置合并与修改检测

JSON 使用固定版本 [jsonc-parser](https://github.com/microsoft/node-jsonc-parser) 建立语法树，接受注释；TOML 使用固定版本 [toml-eslint-parser](https://github.com/ota-meshi/toml-eslint-parser) 的 TOML 1.0 AST。两个依赖均记录在 package-lock 中，保持项目 Node >=22 基线。

- 不用正则解析 TOML。支持表、内联表、带引号的键、点号键、数组及多行字符串；未受管部分保留原始文本。
- 替换 JSON 值只改对应节点；删除属性只删除属性节点及必要逗号，保留相邻注释。
- TOML 根据 AST 范围编辑键或拥有的子树，保留未受管表、键及注释。插入后重新解析并核对目标值。
- 拒绝重复键、非法文档、危险原型键；新配置载荷限定为 JSON 兼容值及安全范围整数。TOML 不接受 null。
- 同文件多个键/区块合成一次文件更新；整文件与共享键/区块、键祖先/后代、目录与子路径所有权冲突都会拒绝。
- 完整文件 fingerprint 包含文本和 mode；链接 fingerprint 为绝对目标。共享资源 fingerprint 只覆盖自身区块内容或键的规范化值，允许用户修改其他键；文件更新的前置条件仍覆盖整份文件和权限。

## 5. 路径与计划前置条件

规划先把已有父目录解析成真实路径，对别名后的物理地址做冲突检查；授权根内部的链接子目录不能逃逸到根外。已有符号别名和实际地址可以合并，但计划同时保留二者的前置条件。悬空父链接拒绝处理，目标操作不能覆盖 Home 元数据或内容仓库。

`assertPlanFresh()` 校验计划摘要、Home/revision、Adapter 签名及所有目标前置条件。外部内容/权限变化、父目录身份改变时返回 `PLAN_STALE`；Adapter 身份漂移返回 `ADAPTER_CHANGED`。

这仍是只读检查。阶段 5 的 Executor 必须在事务锁内调用并复验来源/内容、实际写入及父路径，不能把本阶段检查当作并发安全的替代。持久化计划、来源/插件重新验签、Journal、回滚、真实 AppliedOperation 与联合提交仍待后续阶段。

## 6. 验收映射与限制

- A07：六类 Codex 资产重复规划没有文件写入；版本或引用变化可仅更新元数据。
- B01/B02/B03/B06：共享引用合并、释放归属、placement 差异与 orphan 的计划语义。
- C01/C02：Codex 六类渲染、第三方多操作输出与实例隔离。
- C03/C05/F02：源库存、授权根、物理路径、能力、重叠所有权、拒绝未受管目标。
- C04：同文件多键合并，JSON/TOML 注释与用户配置保留。
- P03/C06：只读的前置条件与 Adapter 漂移检查基础。

当前遇到旧路径与新路径父子重叠、操作类型改变或资产之间转移归属时，要求先释放旧归属；不会把删除旧路径隐式解释成接管授权。文件更新分组若产生依赖环会拒绝计划。

本阶段没有切换旧 CLI/SDK，未执行计划、创建 Target、部署 Cellar 或发布新状态。A02/A03/A05 的旧入口回归仍为 3 项 TODO，不能计入新业务入口已修复结果。

## 7. 本次验证

- `npm run check:all` 退出码 0：严格构建、发布元数据校验通过；快速套件 178 项通过；打包套件 19 项通过；旧入口回归套件 3 项 TODO。
- 收尾补充 3 项边界测试并修正 TOML 内联子树删除的逗号处理；随后重新编译全部源码与测试，阶段 4 专项 33 项全部通过。快速套件当前累计 181 项，本次未重复运行其余未受影响的快速测试。
- `git diff --check` 通过。

验证环境：本机 macOS / Node 24。未运行远程 CI 或需要真实 Codex 凭据的 runtime preflight。打包套件继续验证现有入口，不能代替新 Executor 的端到端验收。
