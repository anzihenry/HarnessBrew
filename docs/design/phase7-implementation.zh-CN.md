# 阶段 7：旧实现清理与发布验收

日期：2026-10-03。代码、文档、本地跨平台候选包验证及真实 Codex runtime 验收已完成。未提交、打 tag、运行远程 CI 或发布 npm/GitHub Release。

## 已落实

- 删除 `src/core/` 的 21 个旧后端模块及 `tests/helpers/legacy-cli.ts`，公开入口只使用新业务服务。
- 删除 15 个旧后端专用测试文件和旧 Formula/Tap 构造器。保留并迁移跨进程锁测试至 `transactions/file-lock`；删除的旧 untap 锁测试由新协调器与多 Home 并发场景覆盖。
- 包验证拒绝 `dist/core/`，检查根模块的运行时导出集合和仅有的两个公开包路径，防止旧实现再次进入发布产物。
- 版本统一为 `1.0.0`，补充 CHANGELOG、破坏性变更及重新接入步骤；中英文架构文档与 README 改为当前实现。
- Release candidate 工作流在构建前执行历史回归，沿用单次构建、跨平台复用候选包和独立 runtime 证据机制。

## 保留的行为覆盖

| 删除的旧测试范围 | 当前覆盖 |
| --- | --- |
| Formula、Tap、安装与升级 | `domain`、`sources`、`resolution`、`application` 与打包生命周期场景 |
| Bundle 与共享所有权 | `planning`、`application`、打包锁复用场景 |
| Target、Adapter 与插件 | `planning`、`execution`、`application` 及六类资产/两种 scope 打包场景 |
| Journal、回滚与并发 | `execution`、`application-transactions`、`transaction-crash`、`locks` |
| Doctor、CLI/SDK 契约 | `application`、打包 JSON/预览/诊断场景 |
| 历史 A02/A03/A05 | `phase2-regressions`，通过公开服务执行 |

测试数从上一阶段的 227 项快速测试降至 142 项，是旧后端专用测试删除后的结果，不表示将失败测试标记为跳过。所有本次通过的测试均无 skipped/TODO。

## 候选包与本地验证

仅构建一次：`node scripts/artifact/build.mjs --output release-artifacts/phase7 --allow-dirty`。

- 文件：`release-artifacts/phase7/harnessbrew-1.0.0.tgz`
- SHA-256：`1ddd6d54db75a18c40bb35e5c95c2479a8b0f8c7729d01d885df8b357b179768`
- 基线 commit：`ea005e0d76a0e4dcc873fe51cfe8ade53cdac960`
- `source.dirty=true`：包含阶段 7 的未提交修改，只作为开发验证证据。发布时必须从已提交源码重新构建一个干净候选包，并重新完成全部 gate。

| 检查 | 环境 | 结果 |
| --- | --- | --- |
| `npm run check` | macOS arm64，Node 24.19.0 / npm 12.0.2 | 构建、142 项快速测试、发布元数据校验通过 |
| `test:packaged` | 同上，共用指定候选包 | 19 项通过 |
| `test:regressions` | 同上 | 3 项通过 |
| `release:gate` | 同上 | artifact、package smoke、五个打包 E2E 场景通过 |
| `test:packaged` | Linux arm64，官方 `node:22-bookworm` 容器，Node 22.23.3 / npm 10.9.9 | 同一候选包，19 项通过 |
| `release:gate` | 同一 Linux 容器 | artifact、package smoke、五个打包 E2E 场景通过 |
| `release:preflight` | macOS 可联网环境，真实 Codex CLI 0.159.2 | skill、instruction、agent、MCP 四项通过 |

两个 gate 报告中的 SHA-256 与上述候选包相同。容器只读挂载源码和候选包，临时安装依赖，仅将报告写回 `release-artifacts/phase7/linux/`。这是本地 Docker 验证，不能代替 GitHub Actions 的 Node/npm 矩阵运行。

报告路径（产物目录被 Git 忽略）：

- `release-artifacts/phase7/macos/release-gate.json`
- `release-artifacts/phase7/linux/release-gate.json`
- `release-artifacts/phase7/runtime-network/runtime-report.json`：可联网环境的四项真实探针全部通过，引用相同候选包摘要。
- `release-artifacts/phase7/runtime/runtime-report.json`：受限沙箱首次尝试，四项探针均在模型响应前失败；报告分类为 product-failure，缺少原始错误，不能据此断言资产有问题或网络有问题。

## 真实 runtime 与发布边界

真实 Codex 0.159.2 使用临时项目、独立 Home 和现有登录的临时认证副本；结束时移除副本。模拟 runtime 的自动测试结果与真实验收分别记录。联网环境重跑的四项探针全部通过：skill/instruction 返回预期标记，agent 同时产生结构化协作事件且 session 清理成功，MCP 同时产生结构化调用事件与本地 fixture 调用证据。首次沙箱失败记录保留，不计为通过。

上次中断时 Docker 镜像拉取因自动审批服务 usage limit 未执行；恢复后重新审批成功，已完成 Linux 验证。

后续发布遵循[1.0.0 检查表](../releases/release-1.0.0.md)：提交源码、构建干净候选包、执行远程 Linux/macOS CI 与真实 runtime、校验证据后，再由用户明确授权发布。
