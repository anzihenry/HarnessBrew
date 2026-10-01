import { applyEdits, createScanner, SyntaxKind, findNodeAtLocation, getNodeValue, modify, parseTree, type Node as JsonNode, type ParseError } from "jsonc-parser";
import { getStaticTOMLValue, parseTOML, traverseNodes, type AST } from "toml-eslint-parser";
import type { ConfigValue } from "../domain/adapter.js";
import { HarnessError } from "../domain/errors.js";
import { canonicalJson } from "../domain/validation.js";

function fail(message: string): never { throw new HarnessError("INVALID_PLAN", message); }
export function configValue(value: unknown): ConfigValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
  if (Array.isArray(value)) return Array.from(value, configValue);
  if (typeof value === "object" && value !== null && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (["__proto__", "constructor", "prototype"].includes(key)) fail("Unsafe config key.");
      return [key, configValue(item)];
    }));
  }
  return fail("Expected a finite JSON-compatible config value.");
}
export function tomlValue(value: ConfigValue): string {
  if (value === null) return fail("TOML does not support null.");
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(", ")}]`;
  if (typeof value === "object") return `{ ${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)} = ${tomlValue(item)}`).join(", ")} }`;
  return JSON.stringify(value);
}
function jsonTree(content: string): JsonNode {
  const errors: ParseError[] = [];
  const tree = parseTree(content.trim() ? content : "{}", errors, { allowTrailingComma: false, disallowComments: false });
  if (!tree || errors.length || tree.type !== "object") return fail("Invalid JSON object configuration.");
  function validate(node: JsonNode): void {
    if (node.type === "object") {
      const keys = node.children?.map(property => String(property.children![0]!.value)) ?? [];
      if (new Set(keys).size !== keys.length) fail("Duplicate JSON config keys.");
    }
    node.children?.forEach(validate);
  }
  validate(tree);
  return tree;
}
function tomlTree(content: string): AST.TOMLProgram {
  try {
    const tree = parseTOML(content, { tomlVersion: "1.0" });
    traverseNodes(tree, { enterNode(node) {
      if (node.type === "TOMLKey" && keyParts(node).some(key => ["__proto__", "prototype", "constructor"].includes(key))) fail("Unsafe TOML config key.");
    }, leaveNode() {} });
    return tree;
  }
  catch (cause) { throw new HarnessError("INVALID_PLAN", "Invalid TOML configuration.", {}, { cause }); }
}
function keyParts(key: AST.TOMLKey): string[] { return key.keys.map(item => item.type === "TOMLBare" ? item.name : item.value); }
function inlineEdit(content: string, node: AST.TOMLInlineTable, keys: string[], value: ConfigValue | undefined, ast: AST.TOMLProgram): string {
  const source = content.slice(...node.range);
  const replace = (start: number, end: number, replacement: string) => source.slice(0, start - node.range[0]) + replacement + source.slice(end - node.range[0]);
  for (const entry of node.body) {
    const key = keyParts(entry.key);
    if (canonicalJson(key) === canonicalJson(keys)) {
      if (value !== undefined) return replace(entry.value.range[0], entry.value.range[1], tomlValue(value));
      const index = node.body.indexOf(entry), next = node.body[index + 1], previous = node.body[index - 1];
      const comma = ast.tokens.find(token => token.value === "," && token.range[0] >= entry.range[1] && token.range[1] <= (next?.range[0] ?? node.range[1]));
      if (comma) return replace(entry.range[0], comma.range[1], "");
      const before = previous && ast.tokens.find(token => token.value === "," && token.range[0] >= previous.range[1] && token.range[1] <= entry.range[0]);
      return replace(before ? before.range[0] : entry.range[0], entry.range[1], "");
    }
    if (prefix(key, keys)) {
      if (entry.value.type !== "TOMLInlineTable") fail("TOML ancestor is not an inline table.");
      return replace(entry.value.range[0], entry.value.range[1], inlineEdit(content, entry.value, keys.slice(key.length), value, ast));
    }
    if (prefix(keys, key)) {
      const owned = node.body.filter(candidate => prefix(keys, keyParts(candidate.key)));
      const ranges: { start: number; end: number }[] = [];
      for (let i = 0; i < node.body.length; i++) {
        if (!owned.includes(node.body[i]!)) continue;
        const first = node.body[i]!, previous = node.body[i - 1];
        while (i + 1 < node.body.length && owned.includes(node.body[i + 1]!)) i++;
        const last = node.body[i]!, next = node.body[i + 1];
        const after = next && ast.tokens.find(token => token.value === "," && token.range[0] >= last.range[1] && token.range[1] <= next.range[0]);
        const before = previous && ast.tokens.find(token => token.value === "," && token.range[0] >= previous.range[1] && token.range[1] <= first.range[0]);
        ranges.push({ start: after ? first.range[0] : before ? before.range[0] : first.range[0], end: after ? after.range[1] : last.range[1] });
      }
      const merged: { start: number; end: number }[] = [];
      for (const range of ranges) {
        const previous = merged.at(-1);
        if (previous && previous.end >= range.start) previous.end = Math.max(previous.end, range.end);
        else merged.push({ ...range });
      }
      let result = source;
      for (const range of merged.reverse()) result = result.slice(0, range.start - node.range[0]) + result.slice(range.end - node.range[0]);
      if (value === undefined) return result;
      return result.slice(0, -1) + `${node.body.length > owned.length ? ", " : " "}${keys.map(key => JSON.stringify(key)).join(".")} = ${tomlValue(value)} }`;
    }
  }
  if (value === undefined) return source;
  return source.slice(0, -1) + `${node.body.length ? ", " : " "}${keys.map(key => JSON.stringify(key)).join(".")} = ${tomlValue(value)} }`;
}
const prefix = (a: readonly (string | number)[], b: readonly (string | number)[]) => a.length <= b.length && a.every((value, i) => value === b[i]);
function lookup(value: unknown, keys: string[]): unknown {
  let current = value;
  for (const key of keys) {
    if (typeof current !== "object" || current === null || Array.isArray(current) || !Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
export function readConfig(content: string, format: "json" | "toml", keys: string[]): unknown {
  if (format === "json") {
    const node = findNodeAtLocation(jsonTree(content), keys);
    return node && configValue(getNodeValue(node));
  }
  return lookup(getStaticTOMLValue(tomlTree(content)), keys);
}
/** Edits only the owned key. Unrelated syntax and comments are retained verbatim. */
export function editConfig(content: string, format: "json" | "toml", keys: string[], value: ConfigValue | undefined): string {
  if (!keys.length || keys.some(key => ["__proto__", "prototype", "constructor"].includes(key))) fail("Unsafe config key path.");
  if (value !== undefined) configValue(value);
  if (format === "json") {
    const source = content.trim() ? content : `${content}{}\n`;
    const tree = jsonTree(source);
    for (let i = 1; i < keys.length; i++) {
      const ancestor = findNodeAtLocation(tree, keys.slice(0, i));
      if (ancestor && ancestor.type !== "object") fail("Config ancestor is not an object.");
    }
    const node = findNodeAtLocation(tree, keys);
    // Replacement preserves comments outside the owned value, including trailing comments.
    if (node && value !== undefined) {
      const result = source.slice(0, node.offset) + JSON.stringify(value) + source.slice(node.offset + node.length);
      jsonTree(result); return result;
    }
    if (node && value === undefined) {
      const property = node.parent!;
      const siblings = property.parent!.children!;
      const index = siblings.indexOf(property), next = siblings[index + 1], previous = siblings[index - 1];
      const scanner = createScanner(source, true);
      let comma: number | undefined;
      const from = next ? property.offset + property.length : previous ? previous.offset + previous.length : 0;
      const to = next ? next.offset : property.offset;
      for (let token = scanner.scan(); token !== SyntaxKind.EOF; token = scanner.scan()) {
        if (token === SyntaxKind.CommaToken && scanner.getTokenOffset() >= from && scanner.getTokenOffset() < to) { comma = scanner.getTokenOffset(); break; }
      }
      const edits = [{ offset: property.offset, length: property.length, content: "" }, ...(comma === undefined ? [] : [{ offset: comma, length: 1, content: "" }])];
      const result = applyEdits(source, edits); jsonTree(result); return result;
    }
    if (!node && value === undefined) return content;
    const result = applyEdits(source, modify(source, keys, value, {}));
    jsonTree(result); return result;
  }
  const ast = tomlTree(content);
  const semantic = getStaticTOMLValue(ast);
  for (let i = 1; i < keys.length; i++) {
    const parent = lookup(semantic, keys.slice(0, i));
    if (parent !== undefined && (typeof parent !== "object" || parent === null || Array.isArray(parent) || parent instanceof Date)) fail("TOML ancestor is not a table.");
  }
  const edits: { start: number; end: number; replacement: string }[] = [];
  let exact: AST.TOMLKeyValue | undefined;
  let inlineHandled = false;
  const removeNode = (node: AST.TOMLNode) => {
    // Leave standalone and trailing comments in place; use parser ranges, never regex TOML parsing.
    const comments = ast.comments.filter(comment => comment.range[0] >= node.range[0] && comment.range[1] <= node.range[1]);
    edits.push({ start: node.range[0], end: node.range[1], replacement: comments.map(comment => content.slice(...comment.range)).join("\n") });
  };
  for (const statement of ast.body[0].body) {
    if (statement.type === "TOMLTable" && prefix(keys, statement.resolvedKey)) { removeNode(statement); continue; }
    const tablePath = statement.type === "TOMLTable" ? statement.resolvedKey : [];
    const entries = statement.type === "TOMLTable" ? statement.body : [statement];
    for (const entry of entries) {
      const entryPath = [...tablePath, ...keyParts(entry.key)];
      if (canonicalJson(entryPath) === canonicalJson(keys)) exact = entry;
      else if (prefix(keys, entryPath)) removeNode(entry);
      else if (prefix(entryPath, keys)) {
        if (entry.value.type !== "TOMLInlineTable") fail("TOML ancestor is not an inline table.");
        edits.push({ start: entry.value.range[0], end: entry.value.range[1], replacement: inlineEdit(content, entry.value, keys.slice(entryPath.length), value, ast) });
        inlineHandled = true;
      }
    }
  }
  if (inlineHandled) { /* The inline value edit already includes insertion or removal. */ }
  else if (exact && value !== undefined) {
    edits.push({ start: exact.value.range[0], end: exact.value.range[1], replacement: tomlValue(value) });
  } else {
    if (exact) removeNode(exact);
    if (value !== undefined) {
      // Insert into the nearest explicit ancestor table, so dotted keys remain valid TOML.
      const ancestors = ast.body[0].body.filter((node): node is AST.TOMLTable => node.type === "TOMLTable" && node.kind === "standard" && node.resolvedKey.length < keys.length && prefix(node.resolvedKey, keys));
      const ancestor = ancestors.sort((a, b) => b.resolvedKey.length - a.resolvedKey.length)[0];
      const offset = ancestor ? ancestor.range[1] : (ast.body[0].body.find(node => node.type === "TOMLTable")?.range[0] ?? content.length);
      const relative = keys.slice(ancestor?.resolvedKey.length ?? 0);
      const insertion = `\n${relative.map(key => JSON.stringify(key)).join(".")} = ${tomlValue(value)}\n`;
      // A key under an implicit table can be defined with dotted syntax before table sections.
      edits.push({ start: offset, end: offset, replacement: insertion });
    }
  }
  let result = content;
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  const actual = readConfig(result, "toml", keys);
  if (value === undefined ? actual !== undefined : canonicalJson(actual) !== canonicalJson(value)) fail("TOML edit did not produce the requested value.");
  return result;
}
