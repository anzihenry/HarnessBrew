# Batch A benchmark

Run `npm run build`, then `node scripts/benchmark/run.mjs > report.json`.
Use `HB_BENCH_COUNTS=10` for a smoke run; the full matrix is 10/100/1000 assets × 256/65536 payload bytes. Git fixture identity and bytes are deterministic except commit metadata; IDs/timings are not compared. Temporary repositories and Homes are removed after each case.

Workload: prepare/register a local Git tap, trust it, search its catalog, install one asset. This measures source-size scaling, not a thousand installed placements. Fixture creation is excluded. Metrics sum operation-local observations: `prepare`, `catalog.load`, `lock.{home,external,resource}.{wait,hold}` are milliseconds; `inventory.bytes`/`journal.bytes` are bytes; `inventory.files`/`journal.writes` are counts. Nested timings overlap and must not be added into total duration. Journal byte counts are serialization attempts, not device-level write amplification.

`batch-a-baseline.json` was measured after adding observational hooks, before moving preparation outside locks. Source commit and dirty flag identify that instrumentation was uncommitted at capture. The A03 commit contains the exact instrumented code and report. The final report uses the same command, fixture sizes and machine. Timings are diagnostic, not fixed CI thresholds. Observer failures are isolated and no payloads, paths or environment credentials are captured.

Use an isolated temporary namespace when running alongside other HarnessBrew processes: `mkdir -p /tmp/hb-benchmark; TMPDIR=/tmp/hb-benchmark node scripts/benchmark/run.mjs > report.json`. Recorded baseline uses this isolation; an initial concurrent run was discarded because the intentionally user-wide external lock caused unrelated test timeouts. Use a separate TMPDIR for tests, never run two benchmark captures in the same namespace.

## A11 comparison (2026-10-06)

`batch-a-after.json` records clean source `aa9b5fd55fea5c7f08239b6390abdf6e430bc436`, Node 24.19.0 on Apple M1 Max / macOS arm64. Both captures use an isolated TMPDIR. Values below are summed milliseconds for the complete workload, rounded to the nearest millisecond.

| Assets | Payload bytes/asset | Total before → after | Home hold before → after | External hold before → after |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 256 | 1194 → 882 | 1134 → 230 | 1079 → 205 |
| 10 | 65536 | 1018 → 882 | 966 → 224 | 920 → 203 |
| 100 | 256 | 4310 → 3420 | 4221 → 282 | 4189 → 262 |
| 100 | 65536 | 5098 → 3477 | 4971 → 284 | 4899 → 264 |
| 1000 | 256 | 34749 → 29937 | 34242 → 1147 | 34184 → 1125 |
| 1000 | 65536 | 31630 → 30229 | 31085 → 1274 | 31046 → 1243 |

Home lock hold fell by 76.8–96.7%; external lock hold fell by 77.9–96.7%. Total duration fell by 4.4–31.8% in these single captures. Git/source preparation, plugin copy/import and ordinary content staging now run outside Home/external transaction locks. Commit still holds those locks for revision and physical identity checks, full source/plugin/content integrity verification, target preconditions, journal publication and state commit. The 1000-asset cases therefore still hold Home locks for about 1.1–1.3 seconds; source inventory verification remains proportional to source size. Resource locks protect cache preparation and can remain long-lived; their summed hold time is not transaction lock time.

Inventory bytes increased by 934 bytes for small payload cases and 131,494 bytes for large payload cases (at most 2.5%), consistent with additional verification of one prepared asset. Journal writes remain 11 per workload. No significant total-time or inventory-I/O regression was observed. Integrity checks were retained, rather than removed to improve timings.

These are single measurements, not p95 results or cross-machine performance guarantees. The workload installs one asset and does not measure large installed populations, network latency, GC, or multi-client throughput. Contention behavior is independently covered by slow-source and multi-process tests. Release/platform/runtime acceptance is tracked separately in A12.
