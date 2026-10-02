# 阶段 6：应用服务、CLI/SDK、Preview 与 Doctor

日期：2026-10-02。依据：[架构决策](refactor-architecture.zh-CN.md)、[数据契约](refactor-contracts.zh-CN.md)、[验收矩阵](refactor-acceptance.zh-CN.md)。

## 1. 已实现范围

| 模块 | 职责 |
| --- | --- |
| `src/application/types.ts`、`requests.ts` | 公开请求、查询、预览、执行和诊断类型；拒绝未知字段与非法参数 |
| `src/application/service.ts` | 组装 Source/Catalog/Resolver/Planner/Coordinator，统一业务入口、来源信任、Bundle 绑定及生命周期 |
| `src/application/adapters.ts` | 内置签名、插件静态声明和完整目录库存、授权后导入核验副本、实例级 registry |
| `src/application/cache.ts` | 宿主拥有的来源、计划和插件缓存目录验证 |
| `src/diagnostics/doctor.ts` | 持有 Home 锁检查状态、内容、依赖、投递和归属；损坏状态下尽可能继续检查 |
| `src/cli.ts` | 参数规范化、调用应用服务、JSON envelope 和退出码；不包含安装或渲染逻辑 |
| `src/index.ts`、`src/adapter.ts` | 新业务 SDK 和独立 Adapter 类型出口 |

主入口已经切换，不提供旧 API、旧命令别名或旧格式转换。`createHarness()` 提供 plan、execute、apply、recover、doctor、query、close；query 的返回类型随查询 kind 确定。SDK 使用与 CLI 相同的锁、恢复与授权流程。

安装、升级、移除、link/unlink、Bundle apply/detach 都经过同一解析和计划链路。单个 manual upgrade 重算依赖闭包并尊重其他使用者的精确版本。释放要求根据已提交记录推导操作，即使来源缓存或插件已漂移，仍可释放不再需要的投递；保留资源继续验证 fingerprint 和内容库存。

## 2. 状态变更与回收

来源注册/更新/删除、信任、插件注册/删除和 cleanup 的元数据发布也经过 Coordinator。新的内部 session.publish 不允许修改活动资产、要求或物理操作；它记录完整 before/next state，并复用 CURRENT 发布、durable committed 标记与回滚协议。

- tap add 默认不可信；tap update 验证完整候选库存后更新选择，不改变安装版本。
- 仍有活动资产的 Tap、仍有 placement 的 Adapter 不能删除。
- cleanup 只释放 orphan 库存。相同摘要仍被其他资产引用时保留内容。
- cleanup 提交前记录内容摘要、设备/inode、目录库存和父路径；提交后将内容移到事务专属隔离目录。
- 删除中断后，只有仍存在的条目均属于原库存且内容/权限未变、隔离目录身份未变时，才继续回收。新增或被修改的文件保留，并保留 Journal 提供恢复诊断。
- 已提交后的清理失败返回成功及维护诊断，后续查询被待恢复事务阻止；recover 不撤销已提交状态。

新的 Home 初始化在同一次 Store 发布中带上内置 Adapter 授权，避免出现可被其他进程观察到的半初始化状态。

## 3. 保存计划与 Bundle

缓存位于 Home 旁的 `.harnessbrew-cache-<id>/`，与活动状态分开，包含 sources、plans、plugins。首次预览不会创建 Home。计划文件为 version 1 的 `harnessbrew.saved-plan`，由宿主保存、附完整摘要；对外只接受 plan ID，不接受操作 JSON。

apply(planId) 核对 Home 物理路径、revision、输入 Manifest、锁文件、来源库存、插件身份与 Target 前置条件。macOS `/var`、`/private/var` 别名按物理路径比较。任何漂移拒绝执行，不重新规划。缓存目录与计划文件不允许符号链接重定向。

新插件 add 的预览不会 import 模块，只返回需要授权执行时校验导出的诊断。插件声明放在 package.json 的 harnessbrew 字段，使用 `harnessbrew.adapter-package` version 1；签名覆盖目录库存，声明依赖时必须有包内已安装依赖及 package-lock.json。首版插件目录拒绝符号链接，第三方能力仍限于 link-directory/link-file。执行导入已校验的内容副本，避免 Node 模块缓存复用另一个签名版本。

Bundle 从新格式 YAML/JSON Manifest 读取，锁路径为 `<manifest-path>.lock.json`。输入目录经 realpath 规范化后生成 binding；同一声明在两个 checkout 各有独立绑定。默认严格应用锁；首次或显式 update-lock 重新解析并联合提交。绑定可在 Manifest 丢失后按 ID detach。

## 4. Doctor 与 repair

Doctor 输出 content、target、dependency、ownership、state 分类，含稳定 code、严重程度、定位和可用动作。它持有 Home 锁；遇到 Journal 明确标记不完整、不健康。CURRENT 或单条状态损坏时，不将原始记录当作变更授权，只尝试继续诊断能够读取的内容与目标。

repair 固定当前要求、版本和 placement，要求来源可信，且内容库存完整。默认只修复选定操作的缺失资源。输出 operations 列明实际操作、placement、资源和 repair-missing/repair-owned 原因。

`--overwrite-owned` 只对可识别且已有归属记录的共享键/区块生效。修改过的链接、整文件、异常类型或无法识别的区块仍拒绝覆盖；仅有路径和旧内容摘要不足以证明持续归属。这是契约中“必须能验证归属”在当前数据模型下的具体限制，不提供通用 force。

## 5. CLI 与公开协议

- 命令覆盖 tap、adapter、install、upgrade、remove、link、unlink、bundle apply/detach、cleanup、repair、recover、doctor、list/search/info/outdated 和 apply-plan。
- placement 默认规范化到 user；link/unlink 遇到多个匹配实例且未指定范围时拒绝歧义。
- 未知参数、重复单值选项、缺值和跨命令无关选项直接拒绝。
- stdout JSON 为一个 `harnessbrew.result` version 1 对象；失败不重复向 stderr 输出文本。
- mode 为 query/preview/execute/recover；退出码为 0/1/2/3/4，与契约一致。
- HarnessError 保留 code/details/cause/recovery，恢复失败的 AggregateError 保留原始故障和恢复故障。
- 公共包不再导出 Store、底层锁、旧 installFormula 等接口；新增 `harnessbrew/adapter` 类型出口。

中英文 README 已改为新源码契约示例。包版本尚未变更，不代表这些破坏性变更已经发布到 npm。

## 6. 验证与后续边界

新增应用层测试覆盖六类 Codex 资产、预览无副作用、保存计划过期、CLI/SDK 一致性、新 Home 预览、插件预览无导入/签名漂移/活动移除保护、双 checkout 绑定、共享修复、撤销信任、损坏状态的部分诊断、元数据回滚及隔离清理恢复。A02/A03/A05 三个 TODO 已替换为新公共服务回归，不再计为待实现。

打包场景已切换到新格式和新入口，覆盖六类资产的 user/project 双 placement、来源历史改写与非法候选、修复、可移植锁复现及 JSON 预览协议。Runtime fixture、package/registry smoke 脚本同步使用新入口。打包测试中的 runtime adapter 是模拟器，不能算作真实 Codex 验收。

阶段 7 仍负责删除 `src/core` 旧实现、移除历史内部测试夹具、最终发布版本与跨平台 CI/真实 runtime 验收。为保持旧后端的回归证据，旧 CLI 仅作为 `tests/helpers/legacy-cli.ts` 测试夹具保留，不在包中发布，也不被新入口调用。未执行远程发布、远程 CI 或真实 Codex 凭据测试。

本次最终验证结果见下方追加记录。

### 本次本地验证

- `npm run check:all` 退出码 0：构建及发布元数据检查通过；快速套件 226 项、打包套件 19 项、历史回归 3 项全部通过，0 TODO。
- 收尾增强插件缓存的锁与原子发布、元数据 Journal 异常时的双错误保留；新增 1 项故障回归后，重新编译完整源码/测试，并复验应用与元数据事务共 20 项，全部通过。快速套件现累计 227 项；未重复运行未受影响的其他套件。
- `git diff --check` 通过。
- 本机 macOS / Node 24。打包测试使用一个共享候选包；runtime preflight 使用模拟 Adapter，不宣称已经完成真实 Codex、Linux CI 或硬件断电验收。
