---
title: 开发与交付验证
status: current
owner: project-maintainers
updated: 2026-10-09
---

# 开发与交付验证

[English](development.en.md)

需要 Node.js 22+、Git 和 npm。CI 源码矩阵为 Node22/npm11.17.0、Node24/npm12.0.2；正式候选工具链固定 Node22/npm11.17.0。

```sh
npm ci
npm run check:docs -- --structure-only
npm run test:docs
npm run check:architecture
npm run build
npm run test:fast
npm run release:verify
```

作者用 structure-only 排查格式，完成内容与双语独立评审并更新批准身份后运行完整检查：

```sh
npm run check:docs
npm run check:all
```

check 包含文档、架构、构建、快速测试和版本检查；check:all 再运行 packaged 与 regressions。打包测试共享一个候选并给每测试私有副本；可设置 HARNESSBREW_TEST_CANDIDATE 指向明确候选。模拟 runtime 只验证探针工具，不能代替真实认证 Codex。

修改行为时更新受影响文档及英文、交付影响清单和独立评审，相关修改使旧身份失效。新评审结论在本次专题记录，再更新检查读取的批准文件。[规范](../documentation.md)定义强制门槛，[发布指南](releasing.md)说明同包跨平台和真实探针。文档检查测试通过临时仓库验证缺失配对、日期、链接/锚点、状态、索引和过期评审均被拒绝。
