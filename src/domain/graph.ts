import { HarnessError } from "./errors.js";
import type { Coordinate } from "./identity.js";

export interface DependencyNode { coordinate: Coordinate; dependencies: readonly Coordinate[]; conflicts: readonly Coordinate[] }

/** Shared by the resolver and committed-state validation. Dependencies precede dependants. */
export function dependencyClosure<T extends DependencyNode>(root: Coordinate, lookup: (name: Coordinate) => T | undefined): T[] {
  const visiting = new Set<Coordinate>();
  const visited = new Set<Coordinate>();
  const result: T[] = [];
  function visit(name: Coordinate, trail: Coordinate[]): void {
    if (visiting.has(name)) throw new HarnessError("DEPENDENCY_CYCLE", `Dependency cycle: ${[...trail, name].join(" -> ")}`, { trail: [...trail, name] });
    if (visited.has(name)) return;
    const node = lookup(name);
    if (!node) throw new HarnessError("DEPENDENCY_MISSING", `Missing dependency: ${name}`, { dependency: name, trail });
    visiting.add(name);
    for (const dependency of [...node.dependencies].sort()) visit(dependency, [...trail, name]);
    visiting.delete(name);
    visited.add(name);
    result.push(node);
  }
  visit(root, []);
  return result;
}
export function assertNoConflicts(nodes: readonly DependencyNode[]): void {
  const coordinates = new Set(nodes.map(node => node.coordinate));
  for (const node of [...nodes].sort((a, b) => a.coordinate < b.coordinate ? -1 : a.coordinate > b.coordinate ? 1 : 0)) {
    for (const conflict of [...node.conflicts].sort()) {
      if (coordinates.has(conflict)) throw new HarnessError("ASSET_CONFLICT", `${node.coordinate} conflicts with ${conflict}.`, { asset: node.coordinate, conflict });
    }
  }
}
