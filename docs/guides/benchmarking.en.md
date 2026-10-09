---
title: Running Source-Size Benchmarks
status: current
owner: project-maintainers
updated: 2026-10-09
---

# Running Source-Size Benchmarks

[中文主版本](benchmarking.md)

Benchmarks diagnose local before/after behavior, not fixed CI thresholds.

```sh
npm run build
mkdir -p /tmp/hb-benchmark
TMPDIR=/tmp/hb-benchmark node scripts/benchmark/run.mjs > report.json
```

HB_BENCH_COUNTS=10 reduces scale; full matrix is 10/100/1000 × 256/65536 bytes. Tests need a separate TMPDIR. Never run two captures in one namespace; the user-wide external lock causes interference.

Local Git input bytes are deterministic; commit metadata/timings are not compared. Fixture creation is excluded and temporary Homes/repos removed afterward. Prepare/catalog.load/lock wait/hold are milliseconds; inventory/journal bytes are bytes; files/writes are counts. Observers default off, isolate failures, and exclude payloads/credentials.

Record environment, source and dirty flag; do not add overlapping nested timings. Workload installs one asset only. See [historical results/limitations](../initiatives/refactor/preparation-boundary/benchmark.en.md).
