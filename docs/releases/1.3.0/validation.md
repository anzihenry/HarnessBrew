---
title: 1.3.0 候选验收
status: verified
owner: project-maintainers
updated: 2026-10-09
---

# 1.3.0 候选验收

[English](validation.en.md)

日期：2026-10-08（Asia/Shanghai）。结论：C01–C10 完成，本地候选验收通过，未正式发布。

## 固定候选

- 版本：`harnessbrew@1.3.0`。
- 源码：`1b95071e2f2580398742419438054c7676113a6e`，构建时工作区干净。
- SHA-256：`b97157a39adef37666d97b49ac6366e2663d81d22077d0878b600d2fa2964fa4`。
- 构建：macOS arm64 / Node 24.19.0 / npm 12.0.2。
- [manifest](evidence/artifact-manifest.json)、[校验和](evidence/SHA256SUMS)。最终 tarball 位于 Git 忽略的 `release-artifacts/batch-c-final/`；此证据提交不属于候选源码 SHA。

## 验收结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 架构边界、构建、版本契约 | 通过 | `npm run check` |
| fast | 286/286 | 含维护、真实崩溃恢复、租约、取消、close、进度及组合用例 |
| packaged | 19/19 | `HARNESSBREW_TEST_CANDIDATE` 显式指向最终候选 |
| regressions | 3/3 | `npm run test:regressions` |
| macOS gate | 通过 | Node 24.19.0 / npm 12.0.2；[报告](evidence/release-gate-macos.json)、[7 个场景](evidence/e2e-macos.md)（英文原始报告） |
| Linux gate | 通过 | Docker Linux arm64 / Node 22.23.3 / npm 11.17.0；[报告](evidence/release-gate-linux.json)、[7 个场景](evidence/e2e-linux.md)（英文原始报告） |
| 真实 Codex | 4/4 | codex-cli 0.162.0-alpha.2；[报告](evidence/runtime-report.json) |
| B 安装→C 升级→一致备份回退 | 通过 | [双包演练报告](evidence/adapter-upgrade-report.json) |
| 统一证据校验 | 通过 | `RELEASE_COMMIT=1b95071e2f2580398742419438054c7676113a6e node scripts/release/evidence.mjs release-artifacts/batch-c-final` |

[测试计数汇总](evidence/test-summary.json)记录各套件结果。两个平台都验证 artifact、package-smoke 和 packaged-e2e。新增 maintenance-controls 场景检查有效计划保护、维护不改变 CURRENT、维护后仍可 apply、JSON stdout 与 stderr 进度分流、超时退出码。真实 skill/instruction/agent/MCP 探针均通过，Agent 协作事件、MCP 实际调用及会话清理符合原验收；损坏内容恢复和 quarantine 原件保留也通过。模拟 runtime 不计入真实结论。

组合用例覆盖：准备升级持有租约时维护拒绝删除；close 等待升级及租约释放；两个 Bundle lock 写入后取消可还原 CURRENT 和原始 lock；durable commit 后清理失败仍返回已提交，recover 完成清理并保留新签名。

## 验收发现与修复

首轮源码 `58f637f75504eea275cf3c79149335d718484f70` 的 macOS 新场景发现 Home 父目录别名问题：`/tmp` 与 `/private/tmp` 的规范化发生在 snapshot 读取时，但维护调用提前捕获了旧路径，导致有效计划被保守标记为未知，并阻止维护。未发生误删。

`1b95071` 调整为先读取 snapshot，再获取规范化 Home；新增跨平台显式父目录 symlink 回归，验证新服务预览、维护执行及原升级计划 apply。修复后重新构建干净候选并重跑完整测试、两个平台及真实 runtime。首轮包留在 `release-artifacts/batch-c/`，不属于本次最终通过证据。

## 兼容与回退边界

旧包为 B 候选 1.2.0，源码 `fc40a3efda361301b0801feae7a1cf72bf18b6d9`，SHA-256 `1d61c99b85ed663a89582e828751656c4dad678db571b75073741dc7690019de`。演练实际运行旧包安装手动资产和两个 Bundle，再用 C 包显式授权内置 Adapter 升级，验证资产 pins 不变、全部 lock 更新、旧 reader 可读；一致恢复 Home、目标和 lock 后，旧包 doctor 通过。

隔离演练备份位于 `release-artifacts/batch-c-final/upgrade/rollback-backup/`，只对应测试 Home，不能用于覆盖实际用户 Home。保留 revision 不等于完整回退备份。

普通保存计划 v2、升级计划 v3 与 Home/Journal/Bundle v1 保持兼容；计划新增 30 天有效期，过期需显式重建。内置 Adapter 闭包签名变化仍须授权升级。默认 TTL 30 天、每类保留 10 项、预算 1 GiB；预算不能覆盖有效计划、运行中任务、CURRENT 或用户 quarantine 保护。未知归属、跨缓存引用、来源历史及 bare Git 仓库保守保留，不保证容量降至预算。

取消只在安全点生效，回滚/恢复可超过期限；提交之后不报告普通取消失败。close 排空已接受请求，不隐式取消。详见 [发布说明](README.md)、[维护策略](../../engineering/maintenance-retention.md)、[操作契约](../../engineering/operation-control.md)。

没有推送分支、创建 tag、发布 npm 或触发生产 workflow。本地 Docker 与 Codex 验收不替代受保护发布流程、生产 provenance 或规定 runner；正式发布仍按 [runbook](../../guides/releasing.md)验证统一候选和证据时效。
