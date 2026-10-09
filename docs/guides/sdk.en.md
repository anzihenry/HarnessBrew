---
title: SDK and Plugins
status: current
owner: project-maintainers
updated: 2026-10-09
---

# SDK and Plugins

[中文主版本](sdk.md)

## SDK and plugins

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

The SDK also exposes `execute`, `recover`, and `doctor`. `HarnessError` has a stable `code`, `details`, `cause`, and recovery guidance. CLI and SDK use the same service. Internal storage and transaction functions are not public SDK exports.

Plugin types come from `harnessbrew/adapter`. Plugins default-export a `TargetAdapter` with protocol `harnessbrew.adapter/1`. Their `package.json` includes:

```json
{
  "type": "module",
  "harnessbrew": {
    "format": "harnessbrew.adapter-package", "version": 1,
    "name": "my-adapter", "adapterVersion": "1", "entry": "index.mjs"
  }
}
```

The signed directory must contain its dependencies and `package-lock.json` when dependencies are declared; symlinks are rejected. Bundled plugins are simplest. Third-party capabilities are limited to links. Previewing a new registration reads declarations without importing code; authorized execution verifies declarations, digest authorization and copy bytes, then imports the copy and validates the exported protocol, name, version and capabilities. Plugins run as host code, not in a sandbox.
