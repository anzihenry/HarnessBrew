---
title: Adapter 升级操作
status: current
owner: project-maintainers
updated: 2026-10-09
---

# Adapter 升级操作

[English](adapter-upgrades.en.md)

## Adapter 升级

先执行静态检查；它不 import 候选代码，也不返回可执行 plan ID：

```sh
harnessbrew adapter inspect-upgrade openai-codex --module builtin:codex --json
```

检查候选 signature、当前/候选版本、签名覆盖文件及受影响 binding 后，显式授权摘要和能力。第三方使用候选包目录代替 `builtin:codex`，能力只允许 `link-directory` / `link-file`；旧声明没有静态能力字段时，requiredCapabilities 返回 null，授权加载后核验实际导出。

```sh
harnessbrew adapter upgrade openai-codex --module builtin:codex \
  --authorize-signature <检查返回的摘要> \
  --capability link-directory --capability link-file --capability write-file \
  --capability write-block --capability set-config \
  --bundle-file ./one/Harnessfile.yaml --bundle-file ./two/Harnessfile.yaml \
  --dry-run
harnessbrew apply-plan <plan-id>
```

只有存在受影响 Bundle 时才传 `--bundle-file`，必须覆盖每个 checkout；漏项返回 `LOCK_MISMATCH` 和 missingBindings。SDK 对应 `inspectAdapterUpgrade({name, module})`，以及 `plan/execute({kind: "adapter.upgrade", name, module, authorizedSignature, capabilities, bundleFiles})`。

升级固定已安装资产 commit、内容摘要及依赖闭包，只重投放指定 Adapter。新注册、目标及全部 Bundle lock 签名在同一事务提交；不会自动升级资产或补充能力。候选漂移返回 `ADAPTER_CHANGED`，预览后输入变化拒绝提交。共享文件保留无关内容；相同资源更换操作类型、父子路径重叠和未经管理的目标可能被拒绝，不提供 force 绕过。干净的重复升级幂等。

升级预览保存为 v3，普通操作仍为 v2；Home、Journal、Bundle lock、CLI result 仍为 v1。旧包注册的内置签名需通过上述显式升级接入新构建规则。回退应保留旧包及一致的 Home/目标/全部 lock 备份；第三方可用保留的旧包执行反向显式升级。仅降级程序不等于回退注册与目标，详见[兼容与回退](../engineering/adapter-upgrades.md)。
