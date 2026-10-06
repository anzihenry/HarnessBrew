import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTapFixture } from '../fixture-tap.mjs';
export async function adapterUpgradeScenario({ environment, cli }) {
  const fixture = await createTapFixture(environment, { id: 'adapter-upgrade' });
  const home = path.join(environment.root, 'adapter-upgrade-home');
  const run = args => cli.runJson([...args, '--home', home]);
  await run(['tap', 'add', fixture.name, fixture.remote]); await run(['tap', 'trust', fixture.name]);
  await run(['install', 'main-skill', '--root', path.join(environment.root, 'adapter-upgrade-target')]);
  const original = (await run(['list'])).envelope.result;
  // Represent a prior registered identity while retaining exact real installed bytes.
  const current = JSON.parse(await readFile(path.join(home, 'CURRENT'), 'utf8'));
  const revision = path.join(home, 'revisions', `${current.revision}.json`);
  const state = JSON.parse(await readFile(revision, 'utf8'));
  state.adapters.registrations.find(a => a.name === 'openai-codex').signature = `sha256:${'a'.repeat(64)}`;
  const bytes = JSON.stringify(state);
  await writeFile(revision, bytes);
  current.digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  await writeFile(path.join(home, "CURRENT"), JSON.stringify(current));
  const inspection = (await run(['adapter', 'inspect-upgrade', 'openai-codex', '--module', 'builtin:codex'])).envelope.result;
  const identity = JSON.parse(await readFile(path.join(environment.paths.installPrefix, 'node_modules/harnessbrew/dist/adapter-identity.json'), 'utf8'));
  assert.equal(inspection.candidate.signature, identity.signature);
  const preview = (await run(['adapter', 'upgrade', 'openai-codex', '--module', 'builtin:codex', '--authorize-signature', inspection.candidate.signature, ...inspection.allowedCapabilities.flatMap(c => ['--capability', c]), '--dry-run'])).envelope.result;
  await run(['apply-plan', preview.planId]);
  assert.equal((await run(['adapter', 'list'])).envelope.result.find(a => a.name === 'openai-codex').signature, identity.signature);
  assert.deepEqual((await run(['list'])).envelope.result.assets, original.assets);
}
