# A12：架构 A 批次候选验收

验收日期：2026-10-07（Asia/Shanghai）。这是本地候选验收记录，不是 npm/GitHub 发布记录，也不代替受保护发布 workflow 的证据来源和审批。

## 候选身份

- 包：`harnessbrew@1.1.0`，`harnessbrew-1.1.0.tgz`。
- 源码：`2689d4a2834ddc0dd67405fda144581bafc65ed9`，构建时工作区干净。
- SHA-256：`fe505af0bd57818596f64ef46ca77b0f88ebc8d27968e05391050df25ce698c9`。
- 本机构建环境：macOS arm64，Node 24.19.0 / npm 12.0.2。
- 本机产物位于 `release-artifacts/batch-a-final/`（Git 忽略）；[manifest](evidence/batch-a/artifact-manifest.json) 和 [SHA256SUMS](evidence/batch-a/SHA256SUMS) 已归档。最终验收后的文档提交不属于候选源码 SHA。

## 检查结果

| 检查 | 结果 | 环境/证据 |
| --- | --- | --- |
| 架构导入边界、TypeScript 构建、版本契约 | 通过 | `npm run check` |
| fast | 205/205 | 包含真实进程竞争、SIGKILL、预览漂移及缓存租约测试 |
| regressions | 3/3 | `npm run test:regressions` |
| packaged | 19/19 | 固定 `HARNESSBREW_TEST_CANDIDATE` 指向最终候选 |
| Linux release gate | 通过 | 一次性 `node:22-bookworm` 容器，Linux arm64 / Node 22.23.3 / npm 11.17.0；[报告](evidence/batch-a/release-gate-linux.json) |
| macOS release gate | 通过 | macOS arm64 / Node 24.19.0 / npm 12.0.2；[报告](evidence/batch-a/release-gate-macos.json) |
| 真实 Codex preflight | 4/4 | `codex-cli 0.160.1`；[报告](evidence/batch-a/runtime-report.json) |
| 证据完整性与身份校验 | 通过 | `scripts/release/evidence.mjs` 核对同一摘要、源码、平台、四探针和时间窗口 |

两个平台 gate 均包含 artifact、package-smoke 和 packaged-e2e。四个真实探针为 skill、instruction、agent、MCP；Agent 有结构化协作事件且会话清理成功，MCP 同时具有结构化事件和 fixture 实际调用记录。内容损坏后的恢复及隔离原件保留也通过。模拟 runtime 测试不计入真实运行时验收。

## 中途失败与处理

版本从 1.0.0 改为 1.1.0 后，两个旧测试仍硬编码 1.0.0；已改为读取当前包版本，并重新通过版本专项 6/6 和完整 fast 205/205。修复提交 `2689d4a` 只改测试，最终重新构建的 tarball 与之前摘要相同，所有最终平台/运行时报告仍重新生成并统一引用最终源码 SHA。

前一轮真实运行时的 skill/instruction 通过，agent/MCP 失败，[失败报告](evidence/batch-a/runtime-report-initial-failed.json) 保留供审计。其脱敏信息不足以确认根因，不将其归因为产品回归或配额问题。最终候选完整重跑四项均首次通过，没有放宽标记、协作事件或 MCP 实际调用要求。

## 兼容、回退与后续发布

A11 六组基准及边界说明见[基准对比](../benchmarks/README.md)。版本和回退规则见 [1.1.0 候选说明](release-1.1.0.md)：saved-plan v1 重新预览，A 不引入活动 Home 迁移；必要时恢复到已验证的前 A 源码版本，禁止将公共旧 0.7.1 当作兼容回退。

本次没有推送分支、创建 tag、发布 npm 或触发生产发布。Linux 使用本地 Docker，真实 Codex 使用隔离临时目录和本机认证；这些报告是开发验收证据。正式发布仍须按[发布 runbook](release-runbook.md)在受保护流程中，用规定工具链重新构建单一候选，取得同次 workflow 的平台与专用 runtime runner 报告并完成审批。不得把本地报告上传为生产来源证明；发布时还需重新核验版本未占用和 72 小时证据时效。
