---
title: 发布验证与正式发布
status: current
owner: project-maintainers
updated: 2026-10-09
---

# 发布验证与正式发布

[English](releasing.en.md)

适用于仓库当前 release 工作流。部署前置条件须核对实际仓库配置，本指南不宣称外部设置已完成。

## 一次性前置条件

正式发布使用 .github/workflows/release.yml 的 Publish approved npm candidate，在 main dispatch 一次，自动验证后等待一次 npm-production 审批，不需手动提交 run ID、报告或 tag。

1. npm-production 环境必须实际配置 required reviewers，限制 main 并在可用时禁止管理员绕过；仅命名环境不产生审批。不得为通过流程移除规则。
2. 准备专用、优先临时 self-hosted/harnessbrew-runtime runner，支持现有 Actions、Node 22、npm 11.17.0、Git 和已登录的探针 CLI；固定并审阅 CLI 版本。
3. runner 只运行受保护 main 的已审代码，禁止 fork/PR/其他仓库共享，按可用能力限制 runner group，保护 workflow/scripts 变更。label 只负责路由，不是隔离。
4. runtime 凭据在专用 runner checkout 外，不上传认证、不复制个人 Home、不配置 npm 发布凭据；使用独立账号/环境并重建 runner。
5. 为 release.yml 和 npm-production 配置 npm trusted publishing；GitHub-hosted 发布 job 审批后才请求 OIDC。
6. 验证 runner/认证后设置 HARNESSBREW_RUNTIME_READY=true，这是运维声明，不是实时健康检查；无 runner 会排队，认证错误会失败。

readiness 检查实际 reviewer rule 和声明，publish 再检查；GitHub 强制审批，不依赖报告字段。

## 准备与触发

更新 package/lock/source 版本、CHANGELOG、版本说明，文档交付检查与独立评审通过后将源码提交 main；版本必须新，不覆盖旧包。

选择 main 执行 Publish approved npm candidate，整个运行绑定 dispatch SHA，后续 push 不改变候选。流程依次：

1. 精确 SHA 调用 reusable Release candidate，检查源码并构建一次。
2. 同包在 Linux/macOS 运行 deterministic release:gate。
3. 两平台成功后，专用 runner 运行真实 Codex skill/instruction/agent/MCP。
4. 下载同一 workflow run 的候选和三份报告，核对身份/完整性，上传批准证据包。
5. 等待 npm-production 审批。
6. 再核验证据，创建或验证不可变 tag，建 draft Release 并上传、下载复验六个附件。
7. 精确 tarball 带 provenance 发布 npm，运行 registry smoke，再检查附件并公开 Release。

没有外部 candidate run ID 或 latest-artifact 查找，依赖关系要求全部候选/探针 job 成功。

## 证据验证

拒绝报告缺失/未知 schema、dirty 源码、错误 SHA/版本/文件名/摘要、探针缺失/重复/跳过/失败、无效时间及超过 72 小时的证据（容许 5 分钟时钟偏差）。平台报告需包含 artifact、package-smoke、packaged-e2e。

真实报告必须恰有四个通过的 Codex 探针、CLI 版本、标记和事件；MCP 必须观察 fixture 实际调用。顶层 passed 不足以通过。真实性依赖受信 workflow/runner 和同次 Actions artifact，不是 JSON 自证；恶意管理员/runner 在保证之外，手工上传不能替代。

## 审批与公开附件

审阅成功 job 和批准证据后审批部署。Release 包含原 npm tgz、artifact-manifest.json、SHA256SUMS、release-gate-linux.json、release-gate-macos.json、runtime-report.json。上传后下载校验，缺失阻止公开，不覆盖不同字节；先保持 draft，避免 smoke 失败仍宣告成功。

## 失败恢复

- npm 接受前修复源码并形成新审阅提交；临时失败可 Re-run failed jobs 复用已成功候选。
- 产物名绑定 run ID/build attempt；重跑全 workflow 产生新候选，不能覆盖已批准或发布的同版本不同字节。
- npm 已接受但 smoke/公开失败时重跑失败 publish job，registry tarball SHA 相同才跳过发布；网络/权限失败不当作版本不存在。
- tag 必须对应候选 commit，已有附件必须相同；冲突停止调查，不 force。
- 超过 72 小时或 artifact 过期时准备新的新鲜证据，不绕过 verifier。
- 重试可能再次审批，正常路径的一次审批不授权任意重试。
- npm 和 GitHub 不是原子事务；npm 成功后版本已公开，后续恢复完成 draft Release，不能假装 npm 已回滚。

独立 candidate dispatch 和本地 preflight 用于诊断，不能绕过生产门槛，也不补写历史附件。
