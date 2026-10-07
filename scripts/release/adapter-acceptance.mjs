import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createE2EEnvironment } from '../e2e/environment.mjs';
import { PackagedCliDriver } from '../e2e/cli-driver.mjs';
import { createTapFixture } from '../e2e/fixture-tap.mjs';
import { installCandidate } from '../artifact/install-candidate.mjs';
import { verifyArtifact } from '../artifact/verify.mjs';

// Diagnostic acceptance only. This does not publish or replace protected release evidence.
const [oldDirectory, candidateDirectory, reportDirectory] = process.argv.slice(2).map(p => path.resolve(p));
if (!oldDirectory || !candidateDirectory || !reportDirectory) throw new Error('Usage: adapter-acceptance.mjs <old-artifact-dir> <candidate-dir> <report-dir>');
async function artifact(directory) {
  const manifestPath = path.join(directory, 'artifact-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const input = { packagePath: path.join(directory, manifest.package.filename), manifestPath, checksumsPath: path.join(directory, 'SHA256SUMS') };
  await verifyArtifact(input); return { input, manifest };
}
const old = await artifact(oldDirectory), candidate = await artifact(candidateDirectory);
const environment = await createE2EEnvironment(candidate.input);
const startedAt = new Date().toISOString();
let passed = false;
try {
  const oldPrefix = path.join(environment.root, 'old-install');
  await installCandidate({ packagePath: old.input.packagePath, installPrefix: oldPrefix, projectRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), cachePath: environment.paths.npmCache, environment: environment.environment });
  const oldCli = new PackagedCliDriver({ ...environment, binary: path.join(oldPrefix, 'node_modules/.bin/harnessbrew') });
  const cli = new PackagedCliDriver(environment);
  const fixture = await createTapFixture(environment, { id: 'old-adapter-install' });
  await oldCli.run(['tap','add',fixture.name,fixture.remote]); await oldCli.run(['tap','trust',fixture.name]);
  await oldCli.run(['install','main-skill','--scope','project','--project',environment.paths.project]);
  const files = [];
  for (const name of ['one','two']) {
    const directory = path.join(environment.root, name); await mkdir(directory);
    const file = path.join(directory, 'Harnessfile.yaml'); files.push(file);
    await writeFile(file, JSON.stringify({format:'harnessbrew.manifest',version:1,id:'old-bundle',sources:[{name:fixture.name,git:fixture.remote}],assets:[{coordinate:`${fixture.name}/main-skill`,placements:[{target:'openai-codex',scope:'project'}]}]}));
    await oldCli.run(['bundle','apply','--file',file]);
  }
  const before = (await oldCli.runJson(['list'])).envelope.result;
  const oldAdapters = (await oldCli.runJson(['adapter','list'])).envelope.result;
  const locks = await Promise.all(files.map(f => readFile(`${f}.lock.json`,'utf8')));
  const backup = path.join(environment.root, 'backup'); await mkdir(backup);
  await cp(environment.paths.harnessHome,path.join(backup,'home'),{recursive:true,verbatimSymlinks:true});
  const roots = [environment.paths.project,...files.map(f=>path.dirname(f))].map(p=>path.join(p,'.agents'));
  for(let i=0;i<roots.length;i++) await cp(roots[i],path.join(backup,`targets-${i}`),{recursive:true,verbatimSymlinks:true});
  const inspection = (await cli.runJson(['adapter','inspect-upgrade','openai-codex','--module','builtin:codex'])).envelope.result;
  assert.notEqual(inspection.current.signature,inspection.candidate.signature);
  const preview=(await cli.runJson(['adapter','upgrade','openai-codex','--module','builtin:codex','--authorize-signature',inspection.candidate.signature,...inspection.allowedCapabilities.flatMap(c=>['--capability',c]),...files.flatMap(f=>['--bundle-file',f]),'--dry-run'])).envelope.result;
  await cli.run(['apply-plan',preview.planId]);
  const after=(await cli.runJson(['list'])).envelope.result;
  assert.deepEqual(after.assets,before.assets); assert.deepEqual(after.requirements,before.requirements);
  for(const file of files) assert.equal(JSON.parse(await readFile(`${file}.lock.json`,'utf8')).adapterSignatures[0].signature,inspection.candidate.signature);
  assert.equal((await cli.runJson(['doctor'])).envelope.result.healthy,true);
  assert.deepEqual((await oldCli.runJson(['list'])).envelope.result.assets,before.assets);
  // All CLI processes exited. Restore the consistent snapshot, not just an executable.
  await rm(environment.paths.harnessHome,{recursive:true}); await cp(path.join(backup,'home'),environment.paths.harnessHome,{recursive:true,verbatimSymlinks:true});
  for(let i=0;i<roots.length;i++){await rm(roots[i],{recursive:true});await cp(path.join(backup,`targets-${i}`),roots[i],{recursive:true,verbatimSymlinks:true});}
  for(let i=0;i<files.length;i++) await writeFile(`${files[i]}.lock.json`,locks[i]);
  assert.deepEqual((await oldCli.runJson(['list'])).envelope.result,before);
  assert.deepEqual((await oldCli.runJson(['adapter','list'])).envelope.result,oldAdapters);
  assert.equal((await oldCli.runJson(['doctor'])).envelope.result.healthy,true);
  await mkdir(reportDirectory,{recursive:true});
  const identity=m=>({filename:m.package.filename,version:m.package.version,sha256:m.package.sha256,commit:m.source.commit});
  await writeFile(path.join(reportDirectory,'adapter-upgrade-report.json'),JSON.stringify({schemaVersion:1,status:'passed',startedAt,completedAt:new Date().toISOString(),artifact:identity(candidate.manifest),oldArtifact:identity(old.manifest),checks:['old-package-install','manual-and-two-bundles','explicit-builtin-upgrade','unchanged-asset-pins','all-lock-signatures','old-reader-compatible','consistent-backup-rollback','old-package-doctor']},null,2)+'\n');
  await cp(backup, path.join(reportDirectory, 'rollback-backup'), {recursive:true,verbatimSymlinks:true});
  for(let i=0;i<files.length;i++) await writeFile(path.join(reportDirectory, 'rollback-backup', `bundle-${i}.lock.json`),locks[i]);
  await writeFile(path.join(reportDirectory,'rollback-backup','locations.json'),JSON.stringify({home:environment.paths.harnessHome,targets:roots,manifests:files},null,2)+'\n');
  passed=true; console.log('Packaged old-install upgrade and consistent rollback passed; isolated rehearsal backup retained.');
} finally {
  if (!passed) environment.preserve();
  await environment.cleanup();
}
