import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checker = path.join(root, 'scripts/check-docs.mjs');
const record = 'docs/initiatives/process/documentation-standard/evidence/independent-review.json';
function fixture(action) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-doc-check-'));
  try {
    for (const name of ['docs','src','tests','scripts','.github','package.json','README.md','README.en.md','CHANGELOG.md','CHANGELOG.en.md','LICENSE','package-lock.json','.npmrc','tsconfig.json','tsconfig.test.json']) fs.cpSync(path.join(root,name),path.join(dir,name),{recursive:true});
    execFileSync('git',['init','-q'],{cwd:dir});
    execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','fixture'],{cwd:dir});
    const run = (...args) => spawnSync(process.execPath,[checker,'--root',dir,...args],{encoding:'utf8'});
    const mutate = (file, fn) => { const p=path.join(dir,file);fs.writeFileSync(p,fn(fs.readFileSync(p,'utf8'))); };
    action({dir,run,mutate});
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}
test('all maintained documents pass structural validation',()=>fixture(({run})=>{
 const r=run('--structure-only');assert.equal(r.status,0,r.stderr);
}));
for (const [name,file,transform,message] of [
 ['missing metadata','README.md',s=>s.replace(/^---\n[\s\S]*?\n---\n/,''),'missing YAML'],
 ['invalid calendar date','README.md',s=>s.replace('updated: 2026-10-09','updated: 2026-02-30'),'invalid calendar date'],
 ['invalid release status','docs/releases/1.3.0/README.md',s=>s.replace('status: verified','status: current'),'status does not match'],
 ['broken local anchor','README.md',s=>s+'\n[Broken](docs/documentation.md#does-not-exist)\n','broken heading anchor'],
 ['missing file','README.md',s=>s+'\n[Missing](docs/missing.md)\n','broken file link'],
 ['cross-language content reference','README.md',s=>s+'\n[Wrong](docs/documentation.en.md)\n','cross-language maintained link'],
 ['stale index','docs/releases/README.md',s=>s.replace('| verified |','| planned |'),'index title/status'],
]) test(`rejects ${name}`,()=>fixture(({run,mutate})=>{
 mutate(file,transform);const r=run('--structure-only');assert.equal(r.status,1);assert.match(r.stderr,new RegExp(message));
}));
test('rejects missing English translation',()=>fixture(({dir,run})=>{
 fs.unlinkSync(path.join(dir,'docs/guides/sdk.en.md'));const r=run('--structure-only');assert.equal(r.status,1);assert.match(r.stderr,/missing maintained bilingual pair/);
}));
test('accepts real heading anchors including duplicate suffixes',()=>fixture(({run,mutate})=>{
 mutate('README.md',s=>s+'\n## Example\n\n## Example\n\n[Valid](#example-1)\n');const r=run('--structure-only');assert.equal(r.status,0,r.stderr);
}));
test('review gate rejects absent or stale identities, including implementation and release-tool changes',()=>fixture(({dir,run,mutate})=>{
 fs.rmSync(path.join(dir,record),{force:true});assert.equal(run().status,1);
 fs.writeFileSync(path.join(dir,record),JSON.stringify({result:'pending'}));
 const r=run('--structure-only','--report','identity.json');assert.equal(r.status,0,r.stderr);
 const snapshot=JSON.parse(fs.readFileSync(path.join(dir,'identity.json'),'utf8'));
 const review={result:'pass',reviewer:'fixture-independent-reviewer',readOnly:true,actualReadScope:['fixture'],remainingBlockingFindings:[],reviewedFiles:snapshot.files};
 fs.writeFileSync(path.join(dir,record),JSON.stringify(review));assert.equal(run().status,0);
 const version=fs.readFileSync(path.join(dir,'src/version.ts'),'utf8');
 mutate('src/version.ts',s=>s+'\n// fixture change\n');const stale=run();assert.equal(stale.status,1);assert.match(stale.stderr,/review missing or stale: src\/version.ts/);
 fs.writeFileSync(path.join(dir,'src/version.ts'),version);
 mutate('scripts/release/evidence.mjs',s=>s+'\n// fixture release-tool change\n');const tool=run();assert.equal(tool.status,1);assert.match(tool.stderr,/review missing or stale: scripts\/release\/evidence.mjs/);
}));
