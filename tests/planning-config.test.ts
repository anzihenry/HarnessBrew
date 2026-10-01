import test from "node:test";
import assert from "node:assert/strict";
import { editConfig, readConfig } from "../src/planning/config.js";
import { editShared, resourceFingerprint } from "../src/planning/resources.js";

for (const format of ["json", "toml"] as const) {
  test(`${format} edits preserve unrelated keys and comments through add/update/remove`, () => {
    const before = format === "json" ? '{\n// Keep me\n"user": {"number": 7}, "servers": {"existing": true}\n}\n' : '# Keep me\nuser.number = 7\n[servers]\nexisting = true # User comment\n';
    const first = editConfig(before, format, ["servers", "ours"], { command: "tool", args: ["a", "b"] });
    assert.deepEqual(readConfig(first, format, ["servers", "ours"]), { command: "tool", args: ["a", "b"] });
    assert.equal(readConfig(first, format, ["user", "number"]), 7);
    const next = editConfig(first, format, ["servers", "ours"], { command: "new" });
    const removed = editConfig(next, format, ["servers", "ours"], undefined);
    assert.equal(readConfig(removed, format, ["servers", "ours"]), undefined);
    assert.equal(readConfig(removed, format, ["servers", "existing"]), true);
    assert.ok(removed.includes("Keep me"));
    if (format === "toml") assert.ok(removed.includes("# User comment"));
  });
}

test("TOML parser handles quoted/dotted keys, multiline strings, arrays and table replacement", () => {
  const text = '# untouched\ntext = """[not.a.table]\ntext"""\n[[workers]]\nname = "user"\n[mcp_servers."a.b"]\ncommand = "old" # preserve\n[mcp_servers.other]\ncommand = "user"\n';
  const next = editConfig(text, "toml", ["mcp_servers", "a.b"], { command: "new", env_vars: ["TOKEN"] });
  assert.equal((readConfig(next, "toml", ["workers"]) as unknown[]).length, 1);
  assert.ok(next.includes('text = """[not.a.table]\ntext"""'));
  assert.ok(next.includes("# preserve"));
  assert.equal(readConfig(next, "toml", ["mcp_servers", "other", "command"]), "user");
  assert.deepEqual(readConfig(next, "toml", ["mcp_servers", "a.b"]), { command: "new", env_vars: ["TOKEN"] });
});

test("config editing rejects ambiguous, malformed and unsafe structures", () => {
  for (const [format, content] of [["json", '{"a":1,"a":2}'], ["toml", "a = 1\na = 2"], ["toml", "[unfinished"]] as const) {
    assert.throws(() => editConfig(content, format, ["b"], 1), { code: "INVALID_PLAN" });
  }
  assert.throws(() => editConfig("{}", "json", ["__proto__", "polluted"], true), { code: "INVALID_PLAN" });
  assert.throws(() => editConfig("a=1", "toml", ["a", "b"], true), { code: "INVALID_PLAN" });
  assert.throws(() => editConfig("", "toml", ["a"], null), { code: "INVALID_PLAN" });
});

test("managed blocks retain surrounding text and reject duplicate/nested markers", () => {
  const resource = { kind: "block" as const, path: "/p/AGENTS.md", marker: "test/assets/a" };
  const operation = { type: "write-block" as const, resource, blockFormat: "html-comment" as const, content: "Instructions\n" };
  const added = editShared("User text\n", resource, operation);
  assert.equal(editShared(added, resource), "User text\n");
  const snapshot = { kind: "file" as const, path: resource.path, content: added + added, mode: 0o644, identity: { physicalPath: resource.path, ancestor: { path: "/p", realPath: "/p", device: "1", inode: "1" } } };
  assert.throws(() => resourceFingerprint(snapshot, resource), { code: "TARGET_MODIFIED" });
});

test("JSON removal retains adjacent comments and separators remain valid", () => {
  for (const source of ['{\n "ours": 1, // keep inline\n // USER COMMENT\n "user": 2\n}\n', '{ "user": 2, /* USER COMMENT */ "ours": 1 }', '{ /* USER COMMENT */ "ours": 1 }']) {
    const result = editConfig(source, "json", ["ours"], undefined);
    assert.ok(result.includes("USER COMMENT"));
    if (source.includes("keep inline")) assert.ok(result.includes("keep inline"));
    assert.equal(readConfig(result, "json", ["ours"]), undefined);
  }
});

test("TOML edits inside inline tables preserve sibling values and quoted punctuation", () => {
  const source = 'servers = { user = { command = "a,b=c" }, other = true } # keep\n';
  const inserted = editConfig(source, "toml", ["servers", "ours"], { args: ["one,two"] });
  assert.equal(readConfig(inserted, "toml", ["servers", "user", "command"]), "a,b=c");
  const changed = editConfig(inserted, "toml", ["servers", "ours", "args"], ["new"]);
  assert.deepEqual(readConfig(changed, "toml", ["servers", "ours", "args"]), ["new"]);
  for (const key of ["user", "ours", "other"]) {
    const removed = editConfig(changed, "toml", ["servers", key], undefined);
    assert.equal(readConfig(removed, "toml", ["servers", key]), undefined);
    assert.ok(removed.includes("# keep"));
  }
});

test("TOML semantic conversion rejects prototype keys before evaluating input", () => {
  assert.throws(() => readConfig('__proto__.harnessbrewPolluted = true', "toml", ["anything"]), { code: "INVALID_PLAN" });
  assert.equal(({} as Record<string, unknown>).harnessbrewPolluted, undefined);
});

test("TOML implicit dotted subtrees in inline tables can be replaced or removed", () => {
  for (const source of ['servers = { ours.command = "a", ours.args = [], user = true }', 'servers = { user = true, ours.command = "a", ours.args = [] }', 'servers = { ours.command = "a", user = true, ours.args = [] }']) {
    const changed = editConfig(source, "toml", ["servers", "ours"], { command: "new" });
    assert.deepEqual(readConfig(changed, "toml", ["servers", "ours"]), { command: "new" });
    assert.equal(readConfig(changed, "toml", ["servers", "user"]), true);
    const removed = editConfig(source, "toml", ["servers", "ours"], undefined);
    assert.equal(readConfig(removed, "toml", ["servers", "ours"]), undefined);
    assert.equal(readConfig(removed, "toml", ["servers", "user"]), true);
  }
});
