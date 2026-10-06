import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
export function violations(file, source) {
  const result = [];
  for (const match of source.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)["']([^"']+)["']/g)) {
    const specifier = match[1];
    const target = specifier.startsWith('.') ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)) : specifier;
    const layer = file.split('/')[0], targetLayer = target.split('/')[0];
    if (['domain', 'resolution'].includes(layer)) {
      if (!(specifier.startsWith('.') && (targetLayer === 'domain' || layer === 'resolution' && targetLayer === 'resolution')) && !['node:path','node:crypto'].includes(specifier)) result.push(`${file}: pure layer cannot import ${specifier}`);
    }
    if (layer === 'diagnostics' && targetLayer === 'application') result.push(`${file}: diagnostics cannot import application`);
    if (['cli.ts','bin.ts'].includes(file) && ['storage','transactions','execution','sources','planning'].includes(targetLayer)) result.push(`${file}: CLI must use application services`);
    if (['cli.ts','bin.ts'].includes(file) && /^(node:)?(fs|child_process)(\/|$)/.test(specifier)) result.push(`${file}: CLI cannot perform filesystem/process I/O directly`);
  }
  return result;
}
async function check(root, relative = '') {
  const result = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const file = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await check(root, file));
    else if (file.endsWith('.ts')) result.push(...violations(file, await readFile(path.join(root, file), 'utf8')));
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const errors = await check('src');
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; } else console.log('Architecture boundaries verified.');
}
