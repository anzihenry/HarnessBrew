# Batch A benchmark

Run `npm run build`, then `node scripts/benchmark/run.mjs > report.json`.
Use `HB_BENCH_COUNTS=10` for a smoke run; the full matrix is 10/100/1000 assets × 256/65536 payload bytes. Git fixture identity and bytes are deterministic except commit metadata; IDs/timings are not compared. Temporary repositories and Homes are removed after each case.

Workload: prepare/register a local Git tap, trust it, search its catalog, install one asset. This measures source-size scaling, not a thousand installed placements. Fixture creation is excluded. Metrics sum operation-local observations: `prepare`, `catalog.load`, `lock.{home,external,resource}.{wait,hold}` are milliseconds; `inventory.bytes`/`journal.bytes` are bytes; `inventory.files`/`journal.writes` are counts. Nested timings overlap and must not be added into total duration. Journal byte counts are serialization attempts, not device-level write amplification.

`batch-a-baseline.json` was measured after adding observational hooks, before moving preparation outside locks. Source commit and dirty flag identify that instrumentation was uncommitted at capture. The A03 commit contains the exact instrumented code and report. The final report will use the same command and machine. Timings are diagnostic, not fixed CI thresholds. Observer failures are isolated and no payloads, paths or environment credentials are captured.

Use an isolated temporary namespace when running alongside other HarnessBrew processes: `mkdir -p /tmp/hb-benchmark; TMPDIR=/tmp/hb-benchmark node scripts/benchmark/run.mjs > report.json`. Recorded baseline uses this isolation; an initial concurrent run was discarded because the intentionally user-wide external lock caused unrelated test timeouts. Use a separate TMPDIR for tests, never run two benchmark captures in the same namespace.
