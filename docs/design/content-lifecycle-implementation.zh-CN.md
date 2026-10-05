# 内容回收与修复实施记录

日期：2026-10-05。契约见[内容生命周期](content-lifecycle.zh-CN.md)。

## 分任务提交

| 任务 | 提交 | 结果 |
| --- | --- | --- |
| 1：契约及验收矩阵 | `9ad0c50` | 定义库存、引用、隔离与精确恢复边界 |
| 2：内容库存 | `4e729d7` | contents 独立于活动坐标，升级保留旧摘要；校验清单与来源引用 |
| 3：按摘要回收 | `7f51ee6` | 无引用内容预览及回收，缺失记录清理，未知/修改内容保留 |
| 4：精确恢复准备 | `15f19a8` | 优先验证缓存，必要时获取已安装 commit，并验证暂存内容 |
| 5：恢复事务 | `d252e45` | 隔离、发布、目标修复与回滚共用日志；隔离原件持久登记 |
| 6：CLI/SDK、Doctor 和文档 | `15488a1` | restore-content、contentChanges、contents/quarantines 查询及分组诊断 |
| 7：完整验收 | 本文所在提交 | 真实进程中断、共享内容、多快照、打包与跨平台验证 |

## 验证范围

- 连续升级保留历史摘要，cleanup 回收旧内容；共享引用未释放时保留内容。
- 内容缺失和修改、未知目录、预览后内容变化、缺失来源缓存、来源撤信和远端前进。
- 精确恢复已安装版本；缺失内容与目标一起恢复；修改内容显式隔离，提交后保留原件。
- 在隔离、记录写后证据、状态发布、提交、写后尚未记账等位置真实 SIGKILL，重启后验证回滚、提交保留或恢复冲突。
- 外部修改隔离内容时停止回滚并保留证据。
- 现有多 Home 互斥、元数据回滚、部分清理恢复和外部新增文件保护测试继续通过。
- 实际安装候选包后完成升级历史回收、内容缺失恢复、修改内容隔离恢复及清理后保留隔离副本。
- 真实 runtime 在安装后先修改 skill，再通过公开 repair 恢复，验证原件隔离，然后启动 Codex 探针。

验收发现并修复了多来源快照的 Catalog 排序不一致问题：恢复准备现在按与 loadCatalog 相同的规则排序，避免错误报告 PLAN_STALE。另补齐共享摘要相关快照缺失时的恢复准备和库存来源一致性检查。

## 最终候选包

- 路径：`release-artifacts/content-lifecycle-final/harnessbrew-1.0.0.tgz`
- SHA-256：`b92dd902bb9a04a689e4d1185804a2a27097be3dccd4e9ad4ec732d2b3a9eddb`
- 构建基线：`15488a1b1155ac8b8cc60f53391a5446d2583e42`，`source.dirty=true`，包含任务 7 修复。
- 此包构建一次，Linux/macOS/runtime 均复用该包。较早的失败候选包与报告留在 `release-artifacts/content-lifecycle/`，不计入最终通过证据。
- 产物目录被 Git 忽略。这是本地开发验收，正式发布仍须从提交后的源码构建干净候选包并运行发布工作流。

| 检查 | 环境 | 结果 |
| --- | --- | --- |
| `npm run check` | macOS arm64 / Node 24.19.0 / npm 12.0.2 | 构建、162 项快速测试和发布元数据校验通过 |
| `test:packaged` | 同上，最终候选包 | 19 项通过 |
| `test:regressions` | 同上 | 3 项通过 |
| `release:gate` | 同上 | artifact、smoke 和五个打包场景通过 |
| `test:packaged` | Linux arm64 / Node 22.23.3 / npm 10.9.9，官方 node:22-bookworm 容器 | 19 项通过 |
| `release:gate` | 同一 Linux 容器 | artifact、smoke 和五个打包场景通过 |
| `release:preflight` 重试 | macOS / 真实 Codex CLI 0.160.0 | 内容恢复、隔离保留及四项探针全部通过 |

以上测试均无 skipped/TODO。Linux 为本地 Docker 验证，未触发远程 GitHub Actions。

## 真实 Codex 结果

最终候选包首次运行（Codex CLI 0.160.0）：内容恢复及隔离验证、skill、instruction 通过；agent/MCP 在生成结果前失败，脱敏报告分类 product-failure，但不足以确定根因。保留 `runtime/runtime-report.json`，不以更早候选包的成功结果替代。

同一候选包恢复后重试全部通过：内容恢复、隔离保留以及 skill、instruction、agent、MCP 四项真实探针均通过。报告为 `runtime-retry/runtime-report.json`，Codex CLI 0.160.0，已核对与 Linux/macOS 报告使用相同候选包 SHA-256 和基线 commit。首次失败报告保留；没有据此推断确定根因。

## 使用和范围

- 新 Home 必须包含 contents、quarantines，不自动迁移旧实验 Home。
- `repair <asset>` 恢复缺失内容；`--restore-content` 显式允许隔离修改内容并恢复精确版本。
- `--overwrite-owned` 仍只授权共享目标键/区块修复。
- 不支持安全检查的特殊文件会停止恢复，保留原数据供检查。
- 隔离副本由用户检查后手动处理；来源缓存、历史 revisions 和隔离副本不由 cleanup 删除。
- 本次按任务逐次提交，未推送远端、打 tag 或发布。
