# 重构接口与数据契约

状态：阶段 1 目标契约。阶段 2 已实现领域与存储基础，进度见[阶段 2 实施记录](phase2-implementation.zh-CN.md)；其余接口仍待后续阶段接入。决策依据见 [架构决策](refactor-architecture.zh-CN.md)。

## 1. 版本与格式

新持久化文档统一使用明确的格式名及该格式独立的版本号：

```json
{ "format": "harnessbrew.install-state", "version": 1 }
```

格式包括 `install-state`、`source-state`、`adapter-state`、`manifest`、`lock`、`plan`、`journal`，均加 `harnessbrew.` 前缀。格式名与 version 必须严格校验。缺少 format 的旧数据返回 `UNSUPPORTED_FORMAT`，不自动转换、覆盖或删除。

新的 Home 初始化只接受空目录或有效的新格式 Home。已存在旧数据时提示使用新的 `--home`，或由用户先备份后重新初始化。原有 Target 文件仍按未受管文件处理，禁止自动接管。旧 CLI/API/插件入口移除，变更以破坏性版本发布。

## 2. 领域模型

以下 `*Id` 为经过校验的字符串类型；`Digest` 为带算法标签的 SHA-256，例如 `sha256:<hex>`；`CommitId` 记录 Git 对象格式与完整对象 ID，不硬编码仅支持 40 位 SHA-1。

| 模型 | 必需字段 | 约束 |
| --- | --- | --- |
| AssetManifest | coordinate、kind、entry、description、dependencies、conflicts、targets | dependencies/conflicts 使用完整坐标；列表去重并规范排序 |
| SourceSnapshot | id、tap、url、commit、treeDigest、contentLocation | contentLocation 指向不可变缓存；ref 仅是来源提示 |
| ResolvedAsset | manifest、snapshotId、commit、contentDigest、inventory | inventory 包含路径、类型、摘要、mode；路径禁止逃逸 |
| Placement | target、scope、projectRoot?、rootOverride? | project scope 必须有绝对项目根；user 不携带 projectRoot |
| UsageRequirement | ownerId、rootCoordinate、resolvedAssets、placements | 每个根保留独立要求，依赖闭包派生；同一依赖可被多个根引用 |
| InstalledAsset | coordinate、contentDigest、commit、dependencies、operations、status | status 为 active/orphan；operations 引用操作 ID，不复制操作内容 |
| AppliedOperation | id、asset、placementIds、resource、type、installedFingerprint、createdDirectories、requirementIds | 单一操作记录由 owner/root 引用集合引用；相同物理操作可对应多个 placement；资源所有权唯一 |
| InstallState | revision、owners、requirements、assets、operations | 一次原子发布；互相引用必须存在；不保留 links/targets/requested 重复字段 |

placementId 由 target、scope、规范化 projectRoot/rootOverride 生成；相同物理资源还必须通过真实路径及资源地址检测别名冲突。不同 placement 映射到同一物理操作，仅在资产版本、操作类型、内容和所有权地址一致时合并引用。

内容摘要包括规范排序后的相对路径、文件字节、目录项及执行权限。时间戳和本机绝对路径不参与可移植摘要。空目录是否存在参与库存；首版不接受资产内符号链接和特殊设备文件。

## 3. 应用 SDK

模块入口：`harnessbrew` 暴露业务服务和结果类型；`harnessbrew/adapter` 暴露插件协议。底层锁、Journal、存储实现不作为公共 SDK。

```ts
interface HarnessService {
  plan(request: ChangeRequest): Promise<PlanPreview>;
  execute(request: ChangeRequest): Promise<ExecutionResult>;
  apply(planId: string): Promise<ExecutionResult>;
  recover(): Promise<RecoveryResult>;
  doctor(query?: DoctorQuery): Promise<DoctorReport>;
  query(query: ReadQuery): Promise<QueryResult>;
  close(): Promise<void>;
}

function createHarness(options: {
  home: string;
  cwd: string;
  userHome: string;
  adapters?: readonly AuthorizedAdapter[];
}): HarnessService;
```

每个实例持有独立 registry 与插件生命周期。相同 Home 的实例仍通过文件锁协调，不能依赖进程内互斥。close 释放实例资源，不修改安装状态。

`ChangeRequest` 为判别联合，kind：`tap.add`、`tap.update`、`tap.remove`、`tap.trust`、`tap.untrust`、`adapter.add`、`adapter.remove`、`asset.install`、`asset.upgrade`、`asset.remove`、`placement.link`、`placement.unlink`、`bundle.apply`、`bundle.detach`、`cleanup`、`repair`。每种请求只接受相关字段，未知字段拒绝。

- 资产请求接受完整 coordinate；CLI 可使用短名称，由同一 Resolver 转换，歧义返回候选坐标。
- placement 必须显式包含 scope；CLI 可将默认 user 规范化为显式字段。
- update-lock、allow-rewind、overwrite-owned 为各自请求的明确字段，不提供通用 force。
- repair 不提升信任，不修改资产版本；损坏 Cellar 返回 `CONTENT_MODIFIED`，要求从锁定来源显式重建安装。
- `ExecutionResult` 包含 transactionId、committedRevision、changes、retained、diagnostics；结果仅在提交后返回。
- SDK 失败抛出带 code、details、cause、recovery 的 `HarnessError`；不让调用方解析自然语言错误文本。

`adapter.add` 接受已安装包路径/模块和授权能力，先检查包身份再显式加载；不执行 npm install。预览只验证可静态读取的插件声明和签名，不导入新插件代码；实际授权执行时再次验证声明与导出一致。移除仍被活动 placement 依赖的 Adapter 返回 `ADAPTER_IN_USE`，先释放 placement 或 detach 使用者。

## 4. 计划与操作

```ts
interface ChangePlan {
  format: "harnessbrew.plan";
  version: 1;
  id: string;
  requestDigest: Digest;
  homeIdentity: string;
  baseRevision: string;
  sourceSnapshots: readonly SnapshotIdentity[];
  adapterSignatures: readonly AdapterSignature[];
  preconditions: readonly ResourceFingerprint[];
  assetChanges: readonly AssetChange[];
  operations: readonly PlannedOperation[];
  desiredStateDigest: Digest;
}
```

计划 ID 对应由宿主持久化的完整计划及新状态草案；不能仅凭一个摘要重新构造语义不明的操作。计划与 Home 绑定，不可复制到另一 Home 执行。操作排序稳定，包含 dependency 操作 ID 和 change reason。缓存丢失返回 `PLAN_NOT_FOUND`，可重新预览。

每条操作具有 type、id、asset、placementId、resource、expectedBefore 和 requiredCapabilities，并按类型携带负载：

| type | 负载 | 所有权 |
| --- | --- | --- |
| `link-directory` / `link-file` | contentDigest、sourceRelativePath | 整个目标路径 |
| `write-file` | UTF-8 内容或受管内容 blob 摘要、mode | 整个目标文件 |
| `write-block` | marker、文本内容、blockFormat | 共享文件中的指定区块 |
| `set-config` | format、结构化 keyPath、typedValue | 共享配置的指定键路径 |
| `remove-owned` | existingOperationId | 从实际记录推导，仅删除该操作拥有的资源 |

Adapter 只返回期望的正向操作。删除由 Planner 根据既有 AppliedOperation 生成，插件不能指定任意删除路径。所有源引用限定于资产内容库存。

配置格式首版明确支持 JSON 与 TOML；配置 codec 必须保留非受管键和注释，不能用正则猜测 TOML 语义。多个操作修改同一共享文件时，由 Planner 合并成一个文件更新组，生成一致的 before/after fingerprint；操作记录仍保留键/区块级所有权。执行前检查同文件的所有操作和冲突。

## 5. Adapter 协议

```ts
interface TargetAdapter {
  protocol: "harnessbrew.adapter/1";
  name: string;
  version: string;
  supportedKinds: readonly AssetKind[];
  requiredCapabilities: readonly OperationCapability[];
  plan(asset: AssetView, placement: ResolvedPlacement): Promise<AdapterPlan>;
}
```

新 protocol 字符串与旧数字 apiVersion 区分，不兼容旧 SDK v1。协议版本与插件版本独立；内置 Adapter 也携带内容签名。

`AssetView` 提供 manifest、contentDigest、库存和限定于该库存的只读内容访问；不暴露可写 Receipt 或 Target 文件句柄。`ResolvedPlacement` 提供宿主解析后的授权根。AdapterPlan 为可序列化的操作列表，生成时间、随机数、环境变量值和网络响应不得进入结果。相同资产/placement/Adapter 签名必须产生相同结果。

计划校验器验证类型、能力授权、资产身份、源边界、目标根、操作唯一性及所有权。核心不根据资产 kind 补齐渲染内容。MCP 凭据仅保存环境变量引用，不将密钥值写进计划、日志或锁文件。

## 6. Manifest、锁与 Bundle 身份

```yaml
format: harnessbrew.manifest
version: 1
id: engineering-tools
sources:
  - name: team/agents
    git: https://example.com/team/agents.git
    ref: main
assets:
  - coordinate: team/agents/review
    placements:
      - target: openai-codex
        scope: project
        project: .
```

- Manifest 路径相对其所在目录解析；信任只来自本机显式授权，manifest 不含 trust 字段。
- Lock 使用 `harnessbrew.lock`，保存 manifest 规范化摘要、每个解析资产的 commit/内容摘要/依赖、根要求、可移植 placements 以及 Adapter 身份和内容签名。
- 首次 apply 无锁生成；有锁时严格验证声明摘要和 Adapter 签名。`--update-lock` 重新解析并在同一事务内提交新锁和安装要求。
- Lock 不包含本机 binding、Home 绝对路径、内容缓存地址或秘密。project/root 允许相对路径；可移植 manifest 禁止机器绝对路径。user placement 在应用时映射到本机用户根。
- Bundle 的本机 binding 使用规范化 manifest 目录及 manifest id，不进入 lock。相同目录/id 的重复 apply 更新同一绑定。
- Manifest 文件名变化但目录/id 相同可保留绑定；移动目录形成新绑定。不存在按名称猜测接管的行为。
- 共享版本发生冲突时不自动修改其他 Bundle 的 lock。可以先显式 detach 冲突绑定、更新并重新 apply，或使用独立 Home；这一过程不宣称跨 Bundle 原子性。

## 7. CLI 和 JSON

主命令：`tap`、`adapter`、`install`、`upgrade`、`remove`、`link`、`unlink`、`bundle apply`、`bundle detach`、`cleanup`、`repair`、`recover`、`doctor`、`list`、`search`、`info`、`outdated`。

- 所有命令支持 `--home`、`--json`。
- 可规划的变更命令支持 `--dry-run`；recover 是恢复动作，不接受 dry-run。
- `apply-plan <id>` 执行此前宿主保存的计划；不接受任意操作 JSON。
- placement 参数：`--target`、`--scope user|project`、`--project`、`--root`；project 缺省为明确的调用 cwd，user 与 project 参数组合冲突时报错。
- `bundle apply --file <path> [--update-lock]`；`bundle detach --binding <id>`。
- `repair <asset> [placement] [--overwrite-owned]`；没有 placement 时修复选定资产全部受管投递，结果列出实例。
- 使用结构化参数解析，未知选项、重复单值参数、缺少参数值均拒绝。

JSON stdout 只输出一个结果，进度写 stderr；JSON 模式不向 stderr 输出重复错误或堆栈：

```json
{
  "format": "harnessbrew.result",
  "version": 1,
  "ok": true,
  "command": "install",
  "mode": "preview",
  "result": { "planId": "...", "changes": [], "retained": [] },
  "diagnostics": []
}
```

失败时 `ok: false`，添加 `error: { code, message, details, recovery? }`；result 若存在只表示诊断，不作为成功结果。doctor 发现问题时返回完整报告且 ok=false。模式为 query/preview/execute/recover，不保留混合人类文本的 output 数组。

退出码：0 成功；1 业务失败或 doctor 不健康；2 参数/格式错误；3 需要恢复或恢复冲突；4 非预期内部故障。SDK/JSON 共享错误码，退出码只用于 CLI。

稳定错误码至少包括：`INVALID_ARGUMENT`、`UNSUPPORTED_FORMAT`、`ASSET_NOT_FOUND`、`AMBIGUOUS_ASSET`、`DEPENDENCY_MISSING`、`DEPENDENCY_CYCLE`、`ASSET_CONFLICT`、`VERSION_CONFLICT`、`SOURCE_UNTRUSTED`、`TARGET_UNSUPPORTED`、`OWNERSHIP_CONFLICT`、`CONTENT_MODIFIED`、`TARGET_MODIFIED`、`ADAPTER_IN_USE`、`ADAPTER_CHANGED`、`LOCK_MISMATCH`、`LOCK_TIMEOUT`、`PLAN_STALE`、`PLAN_NOT_FOUND`、`RECOVERY_REQUIRED`、`RECOVERY_CONFLICT`、`INTERNAL_ERROR`。

Doctor findings 分组：content、target、dependency、ownership、state；每条记录包含稳定 code、asset/operation/resource 定位、严重程度和可用修复动作。不能修复的情况必须说明前置条件，不通过一般 force 绕过归属检查。
