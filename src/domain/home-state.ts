import { parseContents, type ContentRecord } from "./content.js";
import { placementId } from "./placement.js";
import { type SourceSnapshot, sourceSnapshot } from "./assets.js";
import { absolutePath, commitId, coordinate, digest, identifier, tapName, type Digest } from "./identity.js";
import { emptyInstallState, parseInstallState, type InstallState } from "./state.js";
import { array, canonicalJson, format, invalid, record, sortBy, text, unique } from "./validation.js";

export interface SourceRegistration { name: string; url: string; trusted: boolean; selectedSnapshot?: string }
export interface SourceState {
  format: "harnessbrew.source-state"; version: 1; registrations: SourceRegistration[]; snapshots: SourceSnapshot[];
}
export interface AdapterRegistration {
  name: string; module: string; protocol: "harnessbrew.adapter/1"; version: string; signature: Digest; capabilities: string[];
}
export interface AdapterState { format: "harnessbrew.adapter-state"; version: 1; registrations: AdapterRegistration[] }
export interface HomeState {
  format: "harnessbrew.home-state"; version: 1; revision: string;
  quarantines: { path: string; digest: Digest }[]; contents: ContentRecord[]; install: InstallState; sources: SourceState; adapters: AdapterState;
}
export function emptyHomeState(revision: string): HomeState {
  return { format: "harnessbrew.home-state", version: 1, revision,
    quarantines: [], contents: [], install: emptyInstallState(revision),
    sources: { format: "harnessbrew.source-state", version: 1, registrations: [], snapshots: [] },
    adapters: { format: "harnessbrew.adapter-state", version: 1, registrations: [] } };
}
export function parseHomeState(value: unknown): HomeState {
  const item = format(value, "harnessbrew.home-state", ["revision", "install", "sources", "adapters", "contents", "quarantines"]);
  const quarantines = unique(array(item.quarantines, "quarantines", raw => { const value = record(raw, "quarantine", ["path", "digest"]); return { path: absolutePath(value.path), digest: digest(value.digest) }; }), q => q.path, "quarantines");
  const contents = parseContents(item.contents);
  const revision = identifier(item.revision);
  const install = parseInstallState(item.install);
  if (revision !== install.revision) invalid("snapshot revision");
  const sources = format(item.sources, "harnessbrew.source-state", ["registrations", "snapshots"]);
  const registrations = unique(array(sources.registrations, "sources", raw => {
    const source = record(raw, "source registration", ["name", "url", "trusted", "selectedSnapshot"]);
    if (typeof source.trusted !== "boolean") invalid("source trust");
    return { name: tapName(source.name), url: text(source.url, "source URL"), trusted: source.trusted,
      ...(source.selectedSnapshot === undefined ? {} : { selectedSnapshot: identifier(source.selectedSnapshot) }) };
  }), source => source.name, "source registrations");
  const snapshots = unique(array(sources.snapshots, "snapshots", sourceSnapshot), snapshot => snapshot.id, "snapshots");
  const sourcesByName = new Map(registrations.map(source => [source.name, source]));
  const snapshotsById = new Map(snapshots.map(snapshot => [snapshot.id, snapshot]));
  for (const snapshot of snapshots) {
    const source = sourcesByName.get(snapshot.tap);
    if (source !== undefined && source.url !== snapshot.url) invalid("snapshot source reference");
  }
  for (const source of registrations) {
    if (source.selectedSnapshot !== undefined && snapshotsById.get(source.selectedSnapshot)?.tap !== source.name) invalid("selected snapshot reference");
  }
  for (const asset of install.assets) {
    const content = contents.find(c => c.digest === asset.contentDigest);
    if (!content || !content.origins.some(o => o.coordinate === asset.coordinate && o.snapshot.id === asset.snapshotId && canonicalJson(o.snapshot.commit) === canonicalJson(asset.commit))) invalid("installed content reference");
    const snapshot = snapshotsById.get(asset.snapshotId);
    if (!snapshot || (asset.status === "active" && !sourcesByName.has(snapshot.tap)) || snapshot.tap !== coordinate(asset.coordinate).split("/").slice(0, 2).join("/")
      || canonicalJson(commitId(snapshot.commit)) !== canonicalJson(asset.commit)) invalid("installed source snapshot");
  }
  const adapters = format(item.adapters, "harnessbrew.adapter-state", ["registrations"]);
  const adapterRegistrations = unique(array(adapters.registrations, "adapters", raw => {
    const adapter = record(raw, "adapter registration", ["name", "module", "protocol", "version", "signature", "capabilities"]);
    if (adapter.protocol !== "harnessbrew.adapter/1") invalid("adapter protocol");
    const capabilities = unique(array(adapter.capabilities, "capabilities", value => {
      const capability = text(value, "capability");
      if (!["link-directory", "link-file", "write-file", "write-block", "set-config"].includes(capability)) invalid("operation capability");
      return capability;
    }), value => value, "capabilities").sort();
    return { name: identifier(adapter.name), module: text(adapter.module, "adapter module"),
      protocol: "harnessbrew.adapter/1" as const, version: text(adapter.version, "adapter version"), signature: digest(adapter.signature), capabilities };
  }), adapter => adapter.name, "adapter registrations");
  const registered = new Map(adapterRegistrations.map(adapter => [adapter.name, adapter]));
  for (const requirement of install.requirements) for (const placement of requirement.placements) {
    if (!registered.has(placement.target)) invalid("placement adapter reference");
  }
  const placementsById = new Map(install.requirements.flatMap(req => req.placements).map(value => [placementId(value), value]));
  for (const operation of install.operations) for (const id of operation.placementIds) {
    const target = placementsById.get(id);
    if (!target || !registered.get(target.target)?.capabilities.includes(operation.type)) invalid("operation adapter capability");
  }
  sortBy(registrations, source => source.name);
  sortBy(snapshots, snapshot => snapshot.id);
  sortBy(adapterRegistrations, adapter => adapter.name);
  return { format: "harnessbrew.home-state", version: 1, revision, install, contents, quarantines,
    sources: { format: "harnessbrew.source-state", version: 1, registrations, snapshots },
    adapters: { format: "harnessbrew.adapter-state", version: 1, registrations: adapterRegistrations } };
}
