# 阶段 3：来源快照、Catalog 与统一 Resolver

日期：2026-10-01。依据：[架构决策](refactor-architecture.zh-CN.md)、[数据契约](refactor-contracts.zh-CN.md)、[验收矩阵](refactor-acceptance.zh-CN.md)。

## 1. 实现范围

| 模块 | 职责 |
| --- | --- |
| `src/sources/manager.ts` | 获取 Git branch/tag/精确 commit，检查更新连续性，准备并验证来源快照 |
| `src/sources/inventory.ts` | 扫描相对路径、文件字节摘要与权限；拒绝符号链接及特殊文件 |
| `src/catalog/load.ts` | 每次操作读取指定快照，校验声明和库存，产生冻结的 Catalog 数据 |
| `src/resolution/catalog-index.ts` | 为同一解析操作索引最新候选与精确历史版本，检查来源归属 |
| `src/resolution/resolve.ts` | 将请求、当前状态与 Catalog 转成 DesiredState；统一版本、闭包、冲突和引用判断 |
| `src/domain/graph.ts` | Resolver 与已提交状态校验共用依赖遍历、循环检查及冲突规则 |
| `src/domain/bundle.ts` | Bundle manifest、可移植锁与规范化摘要 |
| `src/domain/home-state.ts` | 从 storage 移入 domain；来源、授权、Adapter 与安装的聚合模型不再依赖存储实现 |

`resolveRequest(state, catalog, request)` 是同步纯函数，不读写文件、不获取 Git、不调用 Adapter。输入经校验后复制；输出递归冻结并规范排序。Source Manager 只写调用方指定的隔离缓存，不发布活动来源、授权或安装状态。

本阶段没有切换现有 CLI/SDK。Planner/Adapter、Executor/事务和业务入口依次在阶段 4、5、6 接入。旧流程仍在运行，不能把纯解析层通过的测试等同于端到端业务修复。

## 2. 来源准备协议

```text
<cache>/
├── repositories/<source-id>/       # bare Git repository
├── snapshots/<snapshot-id>/
│   ├── snapshot.json
│   └── content/
└── locks/<source-id>.lock/
```

- SourceRequest 接受 `name`、`url`，以及可选的 `ref` 或精确 `commit`；两者互斥。默认跟随远端符号 HEAD，ref 必须为真实分支或标签名称，不接受 revision 表达式。
- 分支、标签同名且指向不同 commit 时要求使用完整 `refs/heads/...` 或 `refs/tags/...`。支持 SHA-1 和 SHA-256 仓库。
- 传入 `previous` 时，普通更新必须是快进；`allowRewind` 可显式允许非快进。精确 commit 重放不受最新分支连续性限制。
- 用 `ls-tree` 和 `cat-file` 读取对象，不 checkout、不执行 Tap 的 smudge filter，也不初始化子模块。源文件模式规范为 0644/0755，目录为 0755。
- 符号链接、Git submodule、特殊文件、非法相对路径均拒绝。Git 不追踪空目录，因此来源快照只包含 Git 树实际记录的文件及父目录。
- 在临时目录生成内容，验证 Git blob 对象 ID 与库存摘要后 rename 发布。读取已有缓存时再次验证元数据、文件字节、权限、目录集合与 Git 对象；损坏返回 `CONTENT_MODIFIED`，不会静默覆盖。
- 同一来源准备由进程文件锁串行化；失败清理本次临时目录。缓存不是安装状态或完整事务日志，缓存垃圾回收留给后续阶段。
- 当前每次准备会 fetch 来源，包括精确 commit 请求；尚不提供离线模式。Git 命令超时为 60 秒；二进制输出上限为 64 MiB，暂不支持超过该上限的单个 blob/树输出。

## 3. 新 Tap 声明格式

不兼容旧 `schemaVersion` / `formula.json` 格式。

```text
<source>/
├── tap.json
└── assets/
    └── review/
        ├── asset.json
        └── SKILL.md
```

`tap.json`：

```json
{ "format": "harnessbrew.tap", "version": 1 }
```

`assets/review/asset.json`：

```json
{
  "format": "harnessbrew.asset",
  "version": 1,
  "kind": "skill",
  "entry": "SKILL.md",
  "description": "Review changes",
  "dependencies": [],
  "conflicts": [],
  "targets": ["openai-codex"]
}
```

坐标由注册的 Tap 名和资产目录推导，例如 `team/agents/review`。声明不重复存坐标，也不声明本机信任。依赖和冲突必须使用完整坐标。资产摘要覆盖资产目录下的完整库存，包括 `asset.json` 本身。

一个 Catalog 可以包含同一 Tap 的多个历史快照，但只能选择一个作为最新候选。Resolver 的精确 pin 使用 commit 与 contentDigest，共享坐标仍只允许一个活动版本。

## 4. 解析行为

- `asset.install`：复用活动版本，增加 manual 根要求；新增依赖继承根 placement。
- `asset.upgrade`：指定 manual 根或全部 manual 根使用最新候选重新解析闭包；重新计算所有 manual 闭包，使共享依赖保持一致。其他 Bundle 的精确约束发生冲突时返回 `VERSION_CONFLICT`。
- `asset.remove`：只释放 manual 根要求。仍由其他根或 Bundle 引用的资产返回 `retained`；失去全部引用的已安装资产列入 `orphanCoordinates`，不删除内容。
- `placement.link/unlink`：只改变 manual 根的 placement 要求，依赖自动继承；不直接修改实际操作记录。
- `bundle.apply`：用 manifest id 和规范化目录定位 binding，仅替换该 binding 的根与 placement。无锁解析最新；有锁验证声明摘要、精确 commit、内容摘要、依赖图、来源及 Adapter 签名。只有 `updateLock` 才重新选择版本。
- `bundle.detach`：按 binding 释放要求，保留其他使用者的引用。
- 未信任来源可解析为 Cellar-only。新增或更新投放必须来自本机已信任来源，并声明支持目标且有已注册 Adapter；撤销信任后仍允许保留未变化的实际投放和释放要求。
- Bundle 可声明尚未注册的来源，返回 `requiredSources` 供后续应用服务处理；声明不能覆盖已有 URL，也不能提升信任。

DesiredState 保存 `baseRevision`、owners、requirements、资产版本、派生 placement 引用、orphan/retained 和可选的新 Bundle lock。它不是可直接提交的 InstallState：实际资源操作、fingerprint、内容部署及删除顺序由 Planner/Executor 生成与执行。

## 5. 验证与边界

新增来源/Catalog 集成测试与 Resolver 单元测试覆盖：

- Git 精确重放、快进/回退、二进制与执行权限、并发准备、SHA-256、缓存损坏、符号链接/子模块拒绝，以及不执行 checkout filter。
- A01/A02/A03/A04/A06：依赖继承、升级新增依赖、单向声明冲突、缺失/循环、跨 Tap 闭包和短名歧义。
- B04/B05：跨使用者版本约束、共享 manual 依赖升级、释放后保留引用。
- Bundle 独立 binding、重放旧锁、显式更新锁、拒绝篡改依赖图、Adapter 签名变化、来源和信任边界。
- 空 Catalog 下仅凭已安装元数据释放要求；输入无副作用、输出冻结与顺序确定。

上述验收仅覆盖来源与解析语义。A02/A03 在新 Resolver 层有通过的断言，但旧业务入口的 A02/A03/A05 仍保留为 3 个明确 TODO，待后续接入后移除。物理投放、共享文件合并、锁与 Home 联合提交、故障回滚不属于本阶段。

## 6. 本次本地验证

- `npm run check:all` 退出码 0：严格构建、发布元数据检查通过；快速套件 146 项通过；打包套件 19 项通过；旧入口回归套件 3 项 TODO，未计入通过数。
- 收尾增加了 Git 对象读取失败和请求必填字段校验的 2 项测试；随后独立编译完整源码及测试，重新执行全部阶段 3 专项测试，22 项全部通过。快速套件因此累计包含 148 项测试，本次未重复运行未受影响的其他快速测试。
- `git diff --check` 通过。

验证环境为本机 macOS / Node 24。未运行远程 Linux/macOS CI，也未运行需要真实 Codex 凭据的 runtime preflight；打包测试中的 runtime 场景使用测试 Adapter。
