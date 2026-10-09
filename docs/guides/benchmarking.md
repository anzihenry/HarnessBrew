---
title: 运行来源规模基准
status: current
owner: project-maintainers
updated: 2026-10-09
---

# 运行来源规模基准

[English](benchmarking.en.md)

基准用于本机前后诊断，不是固定 CI 性能门槛。

```sh
npm run build
mkdir -p /tmp/hb-benchmark
TMPDIR=/tmp/hb-benchmark node scripts/benchmark/run.mjs > report.json
```

HB_BENCH_COUNTS=10 可缩小规模；完整矩阵为 10/100/1000 × 256/65536 字节。测试使用另一个 TMPDIR，不同时在同命名空间跑两次基准；用户级外部锁会引入互扰。

本地 Git 输入字节固定，提交元数据/时序不比较，fixture 创建不计入，临时 Home/仓库随后删除。prepare、catalog.load、锁 wait/hold 为毫秒，inventory/journal bytes 为字节，files/writes 为计数。observer 默认关闭，失败隔离，不记录正文和凭据。

记录环境、源码和 dirty 标记，嵌套计时不相加。工作负载只安装一个资产，限制及历史结果见[基准对比](../initiatives/refactor/preparation-boundary/benchmark.md)。
