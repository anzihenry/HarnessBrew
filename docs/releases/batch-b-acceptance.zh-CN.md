# B10：架构 B 批次候选验收

日期：2026-10-07（Asia/Shanghai）。结论：本地 B 候选验收通过，未正式发布。B01–B10 按依赖完成并分别提交；B08 按 B07 的前置要求先行。

## 固定候选

- 版本：`harnessbrew@1.2.0`。
- 源码：`fc40a3efda361301b0801feae7a1cf72bf18b6d9`，构建时工作区干净。
- SHA-256：`1d61c99b85ed663a89582e828751656c4dad678db571b75073741dc7690019de`。
- 构建：macOS arm64 / Node 24.19.0 / npm 12.0.2。
- [manifest](evidence/batch-b/artifact-manifest.json)、[校验和](evidence/batch-b/SHA256SUMS)。候选 tarball 在 Git 忽略的 `release-artifacts/batch-b/`；最终证据文档提交不属于候选源码 SHA。

## 验收结果

| 检查 | 结果 | 证据/环境 |
| --- | --- | --- |
| 架构边界、构建、版本契约 | 通过 | `npm run check` |
| fast | 243/243 | 包括候选静态检查、授权、固定资产、并发/崩溃、Bundle、回退与兼容 |
| packaged | 19/19 | 显式共享最终候选，包含包内 Adapter 身份与升级 CLI |
| regressions | 3/3 | 保留 A 及原有升级/冲突回归 |
| Linux gate | 通过 | Linux arm64 Docker / Node 22.23.3 / npm 11.17.0；[报告](evidence/batch-b/release-gate-linux.json) |
| macOS gate | 通过 | macOS arm64 / Node 24.19.0 / npm 12.0.2；[报告](evidence/batch-b/release-gate-macos.json) |
| 真实 Codex | 4/4 | codex-cli 0.162.0-alpha.2；[报告](evidence/batch-b/runtime-report.json) |
| 实际 A 包安装→B 升级→一致备份回退 | 通过 | [双包身份与演练报告](evidence/batch-b/adapter-upgrade-report.json) |
| 证据校验 | 通过 | release/evidence.mjs 验证统一包身份、平台、四探针、时间；另外核对双包验收身份 |

两个平台 gate 都包含 artifact、package-smoke、packaged-e2e。真实 skill/instruction/agent/MCP 四项均首次通过；Agent 协作事件与会话清理、MCP 事件与 fixture 实际调用均被观测到。内容损坏恢复与隔离原件保留也通过。模拟 runtime 测试不计入真实 Codex 结论。

Linux 首次启动检查时 Docker daemon 未运行；启动已安装的 Docker Desktop 后，同一候选 gate 通过。未改动候选包或放宽验收。

## 跨版本与回退证据

旧包是 A 候选 1.1.0，源码 `2689d4a2834ddc0dd67405fda144581bafc65ed9`，摘要 `fe505af0bd57818596f64ef46ca77b0f88ebc8d27968e05391050df25ce698c9`。验收脚本先实际安装并调用旧 CLI 创建手动安装和两个 Bundle，然后用 1.2.0 显式授权内置候选，统一更新注册及两份 lock。资产 pins/依赖要求保持一致，旧包仍能读取 Home 的 v1 状态。停机恢复一致 Home、目标目录和全部 lock 后，旧包 list/adapter list/doctor 均通过。

旧 tarball 保留于 `release-artifacts/batch-a-final/`，隔离演练备份保留于 `release-artifacts/batch-b/upgrade/rollback-backup/`，其中 locations.json 记录原始演练路径。该备份只对应临时测试 Home，不是用户实际安装的备份；不要覆盖实际 Home。生产回退前必须针对真实 Home、所有受管目标和全部 Bundle lock 创建一致备份。

[兼容说明](../design/batch-b-compatibility.zh-CN.md)限定了可承诺范围：普通 saved-plan v2 继续读取，升级预览用 v3；Home/Journal/Bundle lock/CLI result 保持 v1。结构兼容不代表旧 Adapter 可以执行新注册；不能把只降级二进制当作回退。第三方反向显式升级、外部改锁拒绝覆盖、一致备份恢复和每个 lock 的 SIGKILL 边界均有专项覆盖。after-write 尚无持久完成证据时会保留日志并要求人工检查，不声称自动恢复必然成功。

## 发布边界

没有推送分支、创建 tag、发布 npm 或触发生产 workflow。本次 Linux Docker 和本机 Codex 结果是开发候选验收；不能替代受保护 workflow 的证据来源、规定工具链、专用 runtime runner 或部署审批。正式发布应按 [runbook](release-runbook.md)重新验证版本、统一候选及 72 小时证据时效。
