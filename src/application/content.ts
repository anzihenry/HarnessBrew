import { HarnessError } from "../domain/errors.js";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { HomeState } from "../domain/home-state.js";
import { contentReferences } from "../domain/content.js";
import type { Digest } from "../domain/identity.js";
import { image, exists, type FileImage } from "../execution/files.js";
export type { ContentChange } from "../domain/content.js";
import type { ContentChange } from "../domain/content.js";
export interface ContentCheck { path: string; before: FileImage }
export async function planCleanup(state: HomeState, home: string) {
  const candidate = structuredClone(state), checks: ContentCheck[] = [], changes: ContentChange[] = [], diagnostics: string[] = [];
  const root = path.join(home, "content");
  if (await exists(root)) {
    if (!(await lstat(root)).isDirectory()) throw new HarnessError("CONTENT_MODIFIED", "Content root must be a directory.");
    for (const name of await readdir(root)) if (!state.contents.some(c => c.digest === `sha256:${name}`)) diagnostics.push(`Unregistered content preserved: ${path.join(root, name)}`);
  }
  for (const content of state.contents) {
    if (contentReferences(state.install.assets, content.digest).length) continue;
    const destination = path.join(root, content.digest.slice(7));
    let actual: FileImage;
    try { actual = await image(destination, true); }
    catch { diagnostics.push(`Modified or unreadable content preserved: ${content.digest}`); continue; }
    if (actual.kind !== "missing" && (actual.kind !== "content" || actual.digest !== content.digest)) {
      diagnostics.push(`Modified content preserved: ${content.digest}`); continue;
    }
    let bytes = 0;
    if (actual.kind === "content") for (const entry of content.inventory) if (entry.type === "file") bytes += (await lstat(path.join(destination, entry.path))).size;
    checks.push({ path: destination, before: actual });
    changes.push({ digest: content.digest, action: actual.kind === "missing" ? "forget-missing" : "reclaim", path: destination, bytes, affectedAssets: state.install.assets.filter(a => a.contentDigest === content.digest).map(a => a.coordinate) });
    candidate.contents = candidate.contents.filter(c => c.digest !== content.digest);
    candidate.install.assets = candidate.install.assets.filter(a => a.contentDigest !== content.digest);
  }
  // Orphan asset records sharing live content can be released without deleting the content.
  candidate.install.assets = candidate.install.assets.filter(a => a.status === "active" || !contentReferences(state.install.assets, a.contentDigest).length);
  candidate.sources.snapshots = candidate.sources.snapshots.filter(s => candidate.install.assets.some(a => a.snapshotId === s.id) || candidate.sources.registrations.some(r => r.selectedSnapshot === s.id));
  return { candidate, checks, changes, diagnostics };
}
