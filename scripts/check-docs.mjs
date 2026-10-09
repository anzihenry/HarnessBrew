import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';

const rootArg = process.argv.indexOf('--root');
const root = rootArg === -1 ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..') : path.resolve(process.argv[rootArg + 1]);
const evidencePath = 'docs/initiatives/process/documentation-standard/evidence';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const relative = p => path.relative(root, p).split(path.sep).join('/');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.isFile() ? [p] : [];
  });
}
// Raw evidence is immutable and described by its bilingual parent, not translated/reformatted.
const files = [...fs.readdirSync(root).filter(n => n.endsWith('.md')).map(n => path.join(root, n)),
  ...walk(path.join(root, 'docs')).filter(p => p.endsWith('.md') && !relative(p).split('/').includes('evidence') && !relative(p).split('/').includes('assets'))].sort();
const failures = [];
const fail = (p, message) => failures.push({ file: relative(p), message });
const docs = new Map();
const stripFences = text => text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
function anchors(text) {
  const counts = new Map(), result = new Set();
  for (const match of stripFences(text).matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const slug = match[1].toLowerCase().replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '').replace(/\s/g, '-');
    const n = counts.get(slug) ?? 0; counts.set(slug, n + 1); result.add(n ? `${slug}-${n}` : slug);
  }
  for (const match of text.matchAll(/\bid=["']([^"']+)["']/g)) result.add(match[1]);
  return result;
}
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const front = text.match(/^---\n([\s\S]*?)\n---\n/);
  let meta = {};
  if (!front) fail(file, 'missing YAML frontmatter');
  else { try { meta = parse(front[1]); } catch (e) { fail(file, `invalid YAML: ${e.message}`); } }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) { fail(file, 'metadata must be a mapping'); meta = {}; }
  for (const key of ['title', 'status', 'owner', 'updated']) if (typeof meta[key] !== 'string' || !meta[key].trim()) fail(file, `invalid ${key}`);
  const date = typeof meta.updated === 'string' ? new Date(`${meta.updated}T00:00:00Z`) : new Date(NaN);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.updated ?? '') || !Number.isFinite(+date) || date.toISOString().slice(0, 10) !== meta.updated) fail(file, 'invalid calendar date');
  const rel = relative(file);
  const release = /^docs\/releases\/\d+\.\d+\.\d+\//.test(rel);
  const initiative = /^docs\/initiatives\/(feature|improvement|refactor|research|process)\/[^/]+\//.test(rel);
  const states = release ? ['planned','verified','released','cancelled','withdrawn'] : initiative ? ['proposed','active','paused','completed','cancelled'] : ['draft','current','superseded'];
  if (!states.includes(meta.status)) fail(file, 'status does not match document type');
  if (text.match(/^# (.+)$/m)?.[1] !== meta.title) fail(file, 'H1 differs from title metadata');
  for (const component of rel.split('/')) if (!/^(?:README(?:\.[a-z]+)?\.md|CHANGELOG(?:\.[a-z]+)?\.md|[a-z0-9]+(?:[-.][a-z0-9]+)*)$/.test(component)) fail(file, `invalid naming: ${component}`);
  if (/\.zh-CN\.md$/.test(rel) || /^docs\/benchmarks\//.test(rel)) fail(file, 'legacy naming/location');
  docs.set(file, { text, meta, links: [], anchors: anchors(text) });
}
const config = docs.get(path.join(root, 'docs/documentation.md'))?.meta;
if (!Array.isArray(config?.owners) || !config.owners.length) fail(path.join(root, 'docs/documentation.md'), 'configured owners missing');
for (const [file, doc] of docs) {
  if (!config?.owners?.includes(doc.meta.owner)) fail(file, 'owner not configured in documentation.md');
  const en = file.endsWith('.en.md');
  const peer = en ? file.replace(/\.en\.md$/, '.md') : file.replace(/\.md$/, '.en.md');
  const other = docs.get(peer);
  if (!other) fail(file, 'missing maintained bilingual pair');
  else for (const key of ['owner','status']) if (doc.meta[key] !== other.meta[key]) fail(file, `bilingual ${key} mismatch`);
  const source = stripFences(doc.text);
  const linkMatches = [...source.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)];
  for (const match of linkMatches) {
    const target = match[1];
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    if (target.startsWith('/')) { fail(file, 'repository link must be relative'); continue; }
    const [destination, fragment] = target.split('#');
    let absolute;
    try { absolute = destination ? path.resolve(path.dirname(file), decodeURIComponent(destination)) : file; } catch { fail(file, `invalid encoded link: ${target}`); continue; }
    if (absolute !== root && !absolute.startsWith(root + path.sep)) { fail(file, `link leaves repository: ${target}`); continue; }
    if (!fs.existsSync(absolute)) { fail(file, `broken file link: ${target}`); continue; }
    if (fragment && absolute.endsWith('.md') && !anchors(fs.readFileSync(absolute,'utf8')).has(decodeURIComponent(fragment))) fail(file, `broken heading anchor: ${target}`);
    if (docs.has(absolute)) {
      doc.links.push(absolute);
      if (absolute !== peer && en !== absolute.endsWith('.en.md')) fail(file, `cross-language maintained link: ${target}`);
    }
  }
  if (!doc.links.includes(peer)) fail(file, 'missing reciprocal language link');
  if (en && !source.includes('中文主版本')) fail(file, 'translation does not identify Chinese primary');
}
// Every maintained document must be reachable from a main entry.
const reached = new Set();
function visit(file) { if (reached.has(file)) return; reached.add(file); for (const link of docs.get(file)?.links ?? []) visit(link); }
visit(path.join(root,'README.md')); visit(path.join(root,'docs/README.md'));
for (const file of docs.keys()) if (!reached.has(file)) fail(file,'document has no navigation path');
for (const domain of ['engineering','guides','planning','initiatives','releases','research','product','design']) {
  const dir = path.join(root,'docs',domain);
  if (fs.existsSync(dir) && !docs.has(path.join(dir,'README.md'))) fail(dir, 'domain README missing');
}
// Specialized indexes must display the source title/status and cover every entry.
for (const [indexRel, entryPattern] of [
  ['docs/initiatives/README.md', /^docs\/initiatives\/(feature|improvement|refactor|research|process)\/[^/]+\/README\.md$/],
  ['docs/releases/README.md', /^docs\/releases\/\d+\.\d+\.\d+\/README\.md$/],
  ['docs/engineering/decisions/README.md', /^docs\/engineering\/decisions\/\d{4}-[^/]+\.md$/],
]) for (const lang of ['', '.en']) {
  const index = path.join(root,indexRel.replace(/\.md$/, `${lang}.md`));
  for (const [file,doc] of docs) {
    if (file.endsWith('.en.md') || !entryPattern.test(relative(file))) continue;
    const target = lang ? file.replace(/\.md$/,'.en.md') : file;
    const meta = docs.get(target)?.meta;
    const link = path.relative(path.dirname(index),target).split(path.sep).join('/');
    const row = docs.get(index)?.text.split('\n').find(line => line.includes(`](${link})`));
    if (!row || !row.includes(`[${meta?.title}]`) || !row.includes(`| ${meta?.status} |`)) fail(index,`index title/status or entry missing: ${relative(target)}`);
  }
}
// Audit every source disposition and verify moved raw evidence is byte-identical.
const inventoryPath = path.join(root,evidencePath,'migration-inventory.json');
try {
  const inventory=JSON.parse(fs.readFileSync(inventoryPath,'utf8'));
  for(const item of inventory.files ?? []) {
    if(!['move','delete','consolidate','replace','translate'].includes(item.action) || !item.reason) fail(inventoryPath,`incomplete disposition: ${item.source}`);
    for(const target of item.targets ?? []) if(!fs.existsSync(path.join(root,target))) fail(inventoryPath,`missing migration target: ${target}`);
    if(item.action==='move' && (item.source.includes('/evidence/') || item.source.endsWith('.json'))) {
      const target=item.targets?.[0];
      if(target && fs.existsSync(path.join(root,target)) && hash(fs.readFileSync(path.join(root,target)))!==item.sha256) fail(inventoryPath,`raw evidence changed: ${target}`);
    }
    if(['delete','move'].includes(item.action) && !item.targets?.includes(item.source) && fs.existsSync(path.join(root,item.source))) fail(inventoryPath,`obsolete source path retained: ${item.source}`);
  }
} catch(e) { fail(inventoryPath,`invalid migration inventory: ${e.message}`); }

const reviewedPaths = [...files.map(relative), 'scripts/check-docs.mjs','scripts/check-docs.test.mjs','package.json','.github/workflows/ci.yml','.github/workflows/release-candidate.yml','.github/workflows/release.yml',
 ...['src','tests','scripts','.github'].flatMap(dir => walk(path.join(root,dir)).map(relative)),
 'package-lock.json','.npmrc','tsconfig.json','tsconfig.test.json','LICENSE',
 ...walk(path.join(root,'docs')).map(relative).filter(p => p.split('/').includes('evidence') && ![`${evidencePath}/documentation-check.json`,`${evidencePath}/independent-review.json`].includes(p))].sort();
const identities = Object.fromEntries([...new Set(reviewedPaths)].map(p => [p,hash(fs.readFileSync(path.join(root,p)))]));
const structureOnly = process.argv.includes('--structure-only');
if (!structureOnly) {
  const recordPath=path.join(root,evidencePath,'independent-review.json');
  try {
    const review=JSON.parse(fs.readFileSync(recordPath,'utf8'));
    if (review.result!=='pass' || review.readOnly!==true || !review.reviewer || review.remainingBlockingFindings?.length || !review.actualReadScope?.length) fail(recordPath,'independent approval incomplete');
    for (const [p,digest] of Object.entries(identities)) if(review.reviewedFiles?.[p]!==digest) fail(recordPath,`review missing or stale: ${p}`);
  } catch(e) { fail(recordPath,`independent review unavailable: ${e.message}`); }
}
const report={baseCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(), scope:'All maintained root/docs Markdown, configured delivery tooling and source identities; raw evidence is checked separately against the migration inventory.',documentCount:files.length,reviewRequired:!structureOnly,files:identities,failures,result:failures.length?'fail':'pass'};
const reportArg=process.argv.indexOf('--report');
if(reportArg!==-1){const p=process.argv[reportArg+1];if(!p)throw new Error('--report requires a path');fs.writeFileSync(path.resolve(root,p),JSON.stringify(report,null,2)+'\n');}
if(failures.length){for(const f of failures)process.stderr.write(`${f.file}: ${f.message}\n`);process.exitCode=1;}
else process.stdout.write(`Documentation verified: ${files.length} files; ${structureOnly?'structure only, independent review still required':'structure and independent review identities'}.\n`);
