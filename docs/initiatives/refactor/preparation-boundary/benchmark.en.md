---
title: Batch A Source-Size Benchmark
status: completed
owner: project-maintainers
updated: 2026-10-09
---

# Batch A Source-Size Benchmark

[中文主版本](benchmark.md)

Measured 2026-10-06; clean after-source aa9b5fd55fea5c7f08239b6390abdf6e430bc436, Apple M1 Max/macOS arm64, Node 24.19.0. Original [baseline](evidence/batch-a-baseline.json) and [after](evidence/batch-a-after.json) are unchanged. Baseline dirty reflects uncommitted instrumentation, not a clean release source.

Workload: prepare/trust a local tap, search catalog, install one asset; fixture setup excluded. Matrix: 10/100/1000 assets × 256/65536 bytes. Table values are summed milliseconds for the workload, rounded.

| Assets | Payload bytes/asset | Total before → after | Home hold before → after | External hold before → after |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 256 | 1194 → 882 | 1134 → 230 | 1079 → 205 |
| 10 | 65536 | 1018 → 882 | 966 → 224 | 920 → 203 |
| 100 | 256 | 4310 → 3420 | 4221 → 282 | 4189 → 262 |
| 100 | 65536 | 5098 → 3477 | 4971 → 284 | 4899 → 264 |
| 1000 | 256 | 34749 → 29937 | 34242 → 1147 | 34184 → 1125 |
| 1000 | 65536 | 31630 → 30229 | 31085 → 1274 | 31046 → 1243 |

Home lock hold fell 76.8–96.7%, external 77.9–96.7%, total 4.4–31.8%. Full source/plugin/content/target validation remains; 1000 assets still hold Home about 1.1–1.3 seconds. Long-lived resource locks are not transaction locks.

Inventory bytes rose 934 or 131494 (at most 2.5%); Journal writes remain 11 per case. Nested timings overlap and must not be added. Journal bytes count serialization, not device write amplification. Single local measurements are not p95 or cross-machine guarantees, and do not cover large installed placements, network, GC or throughput. Separate tests cover contention. See [1.1.0 acceptance](../../../releases/1.1.0/validation.en.md) and [benchmark methods](../../../guides/benchmarking.en.md).
