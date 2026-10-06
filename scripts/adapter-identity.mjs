import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Hash the emitted runtime closure, not source maps, declarations or build timestamps.
const root = path.resolve(process.argv[2] ?? 'dist');
const pending = ['adapters/codex.js', 'adapters/placement.js', 'planning/config.js'];
const files = new Map();
while (pending.length) {
  const name = pending.pop();
  if (files.has(name)) continue;
  if (name.startsWith('../') || path.isAbsolute(name)) throw new Error('Adapter import escapes build root');
  const bytes = await readFile(path.join(root, name), 'utf8');
  const content = bytes.replace(/^\/\/# sourceMappingURL=.*$/gm, '');
  files.set(name, createHash('sha256').update(content).digest('hex'));
  // TypeScript emits static imports/exports with quoted module specifiers.
  // Reject dynamic imports so a new runtime dependency cannot silently escape coverage.
  if (/\bimport\s*\(/.test(content)) throw new Error(`Dynamic import requires explicit signature coverage: ${name}`);
  for (const match of content.matchAll(/(?:\bfrom\s*|\bimport\s*)["']([^"']+)["']/g)) {
    if (match[1].startsWith('.')) pending.push(path.posix.normalize(path.posix.join(path.posix.dirname(name), match[1])));
  }
}
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const dependencies = Object.fromEntries(Object.entries(lock.packages).filter(([name, pkg]) => name && !pkg.dev).sort(([a], [b]) => a.localeCompare(b)));
const coverage = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([file, sha256]) => ({ file, sha256 }));
const input = { rule: 'harnessbrew.builtin-closure/1', coverage, dependencies };
const signature = `sha256:${createHash('sha256').update(JSON.stringify(input)).digest('hex')}`;
await writeFile(path.join(root, 'adapter-identity.json'), `${JSON.stringify({ ...input, signature }, null, 2)}\n`);
