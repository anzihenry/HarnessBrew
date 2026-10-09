---
title: SDK 与插件
status: current
owner: project-maintainers
updated: 2026-10-09
---

# SDK 与插件

[English](sdk.en.md)

## SDK 与插件

```ts
import { createHarness } from "harnessbrew";

const harness = createHarness({
  home: "/work/harness-home", cwd: "/work/project", userHome: "/home/me"
});
try {
  const preview = await harness.plan({
    kind: "asset.install", coordinate: "team/assets/review",
    placements: [{ target: "openai-codex", scope: "project", projectRoot: "/work/project" }]
  });
  await harness.apply(preview.planId);
  const installed = await harness.query({ kind: "list" });
} finally {
  await harness.close();
}
```

SDK 还提供 execute、recover、doctor。HarnessError 包含稳定 code、details、cause 和恢复提示。CLI 与 SDK 调用同一应用服务，底层 Store、锁和 Journal 不再作为公共 SDK 导出。

插件从 `harnessbrew/adapter` 引用类型，默认导出协议为 `harnessbrew.adapter/1` 的 TargetAdapter。package.json 声明示例：

```json
{
  "type": "module",
  "harnessbrew": {
    "format": "harnessbrew.adapter-package", "version": 1,
    "name": "my-adapter", "adapterVersion": "1", "entry": "index.mjs"
  }
}
```

签名覆盖插件目录；声明依赖时须包含 package-lock.json 和目录内的已安装依赖，不支持符号链接，推荐使用已打包的插件。第三方只允许链接能力。新插件 add 预览只读声明；授权执行先核验声明、摘要授权和副本字节，再导入副本，随后验证导出协议、名称、版本和能力。插件以宿主代码运行，不是进程沙箱。
