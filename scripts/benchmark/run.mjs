import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir, platform, arch, cpus } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { createHarness } from '../../dist/index.js';
import { observe } from '../../dist/observability/measure.js';
const counts = (process.env.HB_BENCH_COUNTS ?? '10,100,1000').split(',').map(Number);
const cases = [];
for (const count of counts) for (const bytes of [256, 65536]) {
  const root = await mkdtemp(path.join(tmpdir(), 'hb-bench-'));
  const repo = path.join(root, 'repo'); await mkdir(repo);
  const git = (...args) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
  let service;
  try {
    await writeFile(path.join(repo, 'tap.json'), JSON.stringify({ format: 'harnessbrew.tap', version: 1 }));
    for (let i = 0; i < count; i++) {
      const name = `asset-${String(i).padStart(4, '0')}`, dir = path.join(repo, 'assets', name); await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, 'asset.json'), JSON.stringify({ format: 'harnessbrew.asset', version: 1, kind: 'skill', entry: 'SKILL.md', description: name, dependencies: [], conflicts: [], targets: ['openai-codex'] }));
      await writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: benchmark\n---\n${'x'.repeat(bytes)}`);
    }
    git('init', '--initial-branch=main'); git('add', '.'); git('-c', 'user.name=Benchmark', '-c', 'user.email=benchmark@example.invalid', 'commit', '-m', 'fixture');
    service = createHarness({ home: path.join(root, 'home'), cwd: root, userHome: path.join(root, 'user') });
    const metrics = {};
    const started = performance.now();
    await observe(event => { metrics[event.name] = (metrics[event.name] ?? 0) + event.value; }, async () => {
      await service.execute({ kind: 'tap.add', name: 'bench/assets', url: repo });
      await service.execute({ kind: 'tap.trust', name: 'bench/assets' });
      await service.query({ kind: 'search' });
      await service.execute({ kind: 'asset.install', coordinate: 'asset-0000' });
    });
    cases.push({ assets: count, payloadBytesPerAsset: bytes, sourceFiles: count * 2 + 1, elapsedMs: performance.now() - started, metrics });
    process.stderr.write(`Completed ${count} assets / ${bytes} bytes\n`);
  } finally { await service?.close(); await rm(root, { recursive: true, force: true }); }
}
process.stdout.write(JSON.stringify({ format: 'harnessbrew.benchmark', version: 1, sourceCommit: execFileSync('git', ['rev-parse','HEAD'], { encoding: 'utf8' }).trim(), sourceDirty: execFileSync('git', ['status','--porcelain'], { encoding:'utf8' }).trim().length > 0, node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, workload: 'tap.add + tap.trust + search + install one pinned asset; source scales, not installed population', cases }, null, 2) + '\n');
