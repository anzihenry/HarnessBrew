---
title: 公开接口与数据契约
status: current
owner: project-maintainers
updated: 2026-10-09
---

# 公开接口与数据契约

[English](contracts.en.md)

适用源码版本：1.3.0。公开类型以 [application/types.ts](../../src/application/types.ts)、[根导出](../../src/index.ts)和 [Adapter 协议](../../src/adapter.ts)为准。

## 公开入口

`harnessbrew` 导出 createHarness、HarnessError、VERSION、runCli 及业务类型；`harnessbrew/adapter` 提供插件契约。底层锁、Journal 和 Store 不作为公共 SDK。

服务方法包括 plan、execute、apply、query、doctor、recover、inspectAdapterUpgrade、planMaintenance、applyMaintenance、recoverMaintenance、close。除 close 外的方法接受独立 OperationOptions；具体参数见[SDK 指南](../guides/sdk.md)和[操作控制](operation-control.md)。

请求 kind 包括 tap.add/update/remove/trust/untrust、adapter.add/remove/upgrade、asset.install/upgrade/remove、placement.link/unlink、bundle.apply/detach、cleanup、repair。维护使用独立服务方法。repair 支持一个 coordinate 或 all=true，不能同时选择，all 不能指定 placement。未知字段拒绝。

## 状态与格式

声明严格校验 format/version，不从旧目录猜测所有权。Home、安装、来源、Adapter、资产、快照、Manifest、Bundle lock、ChangePlan、Journal 和 CLI result 保持各自 v1；普通保存计划为 v2，升级保存计划为 v3，维护计划和日志独立存储。saved-plan v1 返回 PLAN_STALE，重新预览。缺少 contents/quarantines 的实验 Home 不自动迁移。

Home 包含 CURRENT、不可变 revisions、安装与来源/Adapter 状态、contents 库存及 quarantines。活动资产每坐标只有一个版本；独立 usage requirements 表达根要求、依赖闭包和 placement。引用必须完整，内容摘要涵盖相对路径、字节、目录项和执行权限，不包含时间戳或本机绝对路径。资产不接受符号链接、特殊设备或路径逃逸。

## 操作与所有权

操作类型为 link-directory、link-file、write-file、write-block、set-config；remove-owned 从已有操作归属生成。Adapter 只提供正向期望操作，删除由 Planner 决定。能力、库存源路径、目标根、资源重叠和前置指纹均验证。

完整文件和链接拥有路径；共享区块/配置拥有具体地址。相同物理操作只有资产版本、类型、内容和归属一致时才合并引用。JSON/TOML 修改保留非受管键和注释。MCP 凭据只保存环境变量引用，不把秘密写入计划、日志和锁。

## Bundle 与结果

Manifest 使用 harnessbrew.manifest/1，信任只来自本机授权。Lock 保存声明摘要、固定 commit/内容/依赖、根要求、可移植 placements 和 Adapter 签名，不包含本机 Home、binding 或秘密。binding 由 Manifest ID 和规范化目录决定；不同 checkout 独立。签名或声明变化须显式 update-lock，Adapter 联合升级见[升级契约](adapter-upgrades.md)。

PlanPreview 包含 planId、baseRevision、effects、changes、operations、fileUpdates、contentChanges、retained 和 diagnostics。执行结果区分 committed/unchanged 与 complete/recovery-required。失败使用 HarnessError 的 code、details、cause 和 recovery，不解析自然语言。

CLI stdout 使用单一 harnessbrew.result/1 envelope，进度写 stderr。基础退出码 0 成功、1 业务失败/诊断不健康、2 参数/格式错误、3 需要恢复/冲突、4 非预期故障；取消 130、超时 124。命令和 JSON 示例见[使用指南](../guides/using.md)及[恢复指南](../guides/recovery.md)。
