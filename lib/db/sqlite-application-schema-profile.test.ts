import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { canonicalJson } from "../canonical-json";
import { assertSqliteApplicationSchemaProfile as assertProfile, sqliteApplicationSchemaProfile as profile } from "./sqlite-application-schema-profile";

const opened: DatabaseSync[] = [], folders: string[] = [];
const empty = new Set<string>();
function database(file = ":memory:", readOnly = false) {
  // Deliberately damaged synthetic catalogs exercise refusal parity. Production
  // connections retain their default defensive setting; no live file is opened.
  const db = new DatabaseSync(file, { readOnly, defensive: false }); opened.push(db); return db;
}
function specimen() {
  const db = database();
  db.exec(`CREATE TABLE records(id TEXT PRIMARY KEY,value TEXT); CREATE INDEX records_value ON records(value);
    CREATE VIEW record_names AS SELECT id FROM records;
    CREATE TRIGGER records_notice AFTER INSERT ON records BEGIN SELECT 1; END;`);
  return db;
}
function acceptsLikeOracle(db: DatabaseSync, excluded: ReadonlySet<string>, profiles: readonly string[]) {
  let accepts = false;
  try { accepts = profiles.includes(profile(db, excluded)); } catch { /* The original assertion also refuses. */ }
  if (accepts) expect(() => assertProfile(db, excluded, profiles)).not.toThrow();
  else expect(() => assertProfile(db, excluded, profiles)).toThrow();
  return accepts;
}
function storedRow(db: DatabaseSync, name: string, sql: string | null, type = "view", table = name) {
  db.exec("PRAGMA writable_schema=ON");
  db.prepare("INSERT INTO sqlite_schema(type,name,tbl_name,rootpage,sql) VALUES(?,?,?,0,?)").run(type, name, table, sql);
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of opened.splice(0).reverse()) db.close();
  for (const folder of folders.splice(0)) {
    if (!resolve(folder).startsWith(resolve(tmpdir()) + sep) || !folder.includes("keryx-schema-profile-")) throw Error("Unsafe fixture cleanup");
    rmSync(folder, { recursive: true, force: true });
  }
});

it("matches the complete canonical table/index/view/trigger document and all supplied alternatives", () => {
  const db = specimen(), expected = profile(db, empty);
  expect(acceptsLikeOracle(db, empty, [expected])).toBe(true);
  expect(acceptsLikeOracle(db, empty, ["[]", expected])).toBe(true);
  expect(acceptsLikeOracle(db, empty, Object.freeze([expected]))).toBe(true);
  expect(acceptsLikeOracle(database(), empty, ["[]"])).toBe(true);
  expect(acceptsLikeOracle(db, empty, [])).toBe(false);
});

it.each([
  ["changed SQL", "UPDATE sqlite_schema SET sql=sql||' ' WHERE name='records_value'"],
  ["extra object", "CREATE VIEW extra_profile AS SELECT 1"],
  ["missing object", "DROP VIEW record_names"],
  ["changed table name", "UPDATE sqlite_schema SET tbl_name='different' WHERE name='records_value'"],
  ["changed type", "UPDATE sqlite_schema SET type='view' WHERE name='records_value'"],
  ["changed NULL", "UPDATE sqlite_schema SET sql=NULL WHERE name='records_value'"],
  ["duplicate row", "INSERT INTO sqlite_schema SELECT type,name,tbl_name,rootpage,sql FROM sqlite_schema WHERE name='records_value'"],
  ["duplicate replacing a missing row", "DELETE FROM sqlite_schema WHERE name='record_names'; INSERT INTO sqlite_schema SELECT type,name,tbl_name,rootpage,sql FROM sqlite_schema WHERE name='records_value'"],
])("freshly refuses %s after a previously successful assertion", (_name, change) => {
  const db = specimen(), expected = profile(db, empty);
  assertProfile(db, empty, [expected]);
  db.exec("PRAGMA writable_schema=ON"); db.exec(change);
  expect(acceptsLikeOracle(db, empty, [expected])).toBe(false);
});

it("preserves NULL definitions, duplicate multiplicity, implicit-index exclusion and exact BINARY ordering", () => {
  const db = specimen();
  storedRow(db, "null_definition", null, "index", "records");
  storedRow(db, "duplicate", "SELECT 1"); storedRow(db, "duplicate", "SELECT 2");
  storedRow(db, "\u{10000}", "SELECT 3"); storedRow(db, "\ue000", "SELECT 4");
  const expected = profile(db, empty), rows = JSON.parse(expected);
  expect(rows.some((row: { name: string }) => row.name.startsWith("sqlite_autoindex"))).toBe(false);
  expect(acceptsLikeOracle(db, empty, [expected])).toBe(true);
  expect(acceptsLikeOracle(db, empty, [canonicalJson([...rows].reverse())])).toBe(false);
});

it("retains exact bound exclusions and SQLite LIKE wildcard semantics, even when the exclusion Set changes", () => {
  const db = specimen(); storedRow(db, "sqliteXhidden", "SELECT 1");
  const excluded = new Set(["records_notice"]), expected = profile(db, excluded);
  expect(expected).not.toContain("sqliteXhidden");
  expect(acceptsLikeOracle(db, excluded, [expected])).toBe(true);
  db.exec("DROP TRIGGER records_notice; CREATE TRIGGER records_notice AFTER INSERT ON records BEGIN SELECT 2; END;");
  expect(acceptsLikeOracle(db, excluded, [expected])).toBe(true);
  excluded.clear(); expect(acceptsLikeOracle(db, excluded, [expected])).toBe(false);
  const many = new Set(Array.from({ length: 2048 }, (_, i) => `excluded-${i}`));
  expect(acceptsLikeOracle(db, many, [profile(db, many)])).toBe(true);
  many.add("one-too-many"); expect(acceptsLikeOracle(db, many, [expected])).toBe(false);
});

it.each([
  ["name byte limit", "é".repeat(128), "SELECT 1", "view", "x"],
  ["table-name byte limit", "x", "SELECT 1", "view", "é".repeat(128)],
  ["SQL byte limit", "x", "x".repeat(131072), "view", "x"],
] as const)("admits the exact %s and rejects the next UTF-8 byte", (_label, name, sql, type, table) => {
  const db = database(); storedRow(db, name, sql, type, table);
  expect(acceptsLikeOracle(db, empty, [profile(db, empty)])).toBe(true);
  const expected = profile(db, empty), column = _label.startsWith("name") ? "name" : _label.startsWith("table") ? "tbl_name" : "sql";
  db.prepare(`UPDATE sqlite_schema SET ${column}=${column}||'x'`).run();
  expect(acceptsLikeOracle(db, empty, [expected])).toBe(false);
});

it("keeps the exact 2048-row cap and refuses an extra row before native serialization", () => {
  const db = database(); db.exec("BEGIN");
  for (let i = 0; i < 2048; i++) storedRow(db, `row-${i}`, "SELECT 1");
  db.exec("COMMIT");
  const expected = profile(db, empty);
  expect(acceptsLikeOracle(db, empty, [expected])).toBe(true);
  storedRow(db, "overflow", "SELECT 1");
  expect(acceptsLikeOracle(db, empty, [expected])).toBe(false);
});

it.each(["raw", "encoded"] as const)("refuses the independent 2 MiB %s cap", kind => {
  const db = database(), expected = "[]";
  const sql = (kind === "raw" ? "x" : '"').repeat(120000), count = kind === "raw" ? 18 : 9;
  for (let i = 0; i < count; i++) storedRow(db, `row-${i}`, sql);
  const rows = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all();
  expect(Buffer.byteLength(canonicalJson(rows))).toBeGreaterThan(2 * 1024 * 1024);
  if (kind === "encoded") expect(count * sql.length).toBeLessThan(2 * 1024 * 1024);
  expect(acceptsLikeOracle(db, empty, [expected])).toBe(false);
  expect(acceptsLikeOracle(db, empty, [canonicalJson(rows)])).toBe(false);
});

it("admits exactly 2 MiB canonical encoded bytes and refuses one added byte with raw bytes still below the cap", () => {
  const db = database();
  for (let i = 0; i < 9; i++) storedRow(db, `row-${i}`, "");
  let remaining = 2 * 1024 * 1024 - Buffer.byteLength(profile(db, empty));
  for (let i = 0; i < 9; i++) {
    const quotes = Math.min(131072, Math.floor(remaining / 2));
    const text = '"'.repeat(quotes) + (i === 8 && remaining % 2 ? "x" : "");
    db.prepare("UPDATE sqlite_schema SET sql=? WHERE name=?").run(text, `row-${i}`);
    remaining -= Buffer.byteLength(JSON.stringify(text)) - 2;
  }
  expect(remaining).toBe(0);
  const expected = profile(db, empty);
  expect(Buffer.byteLength(expected)).toBe(2 * 1024 * 1024);
  expect(acceptsLikeOracle(db, empty, [expected])).toBe(true);
  db.exec("UPDATE sqlite_schema SET sql=sql||'x' WHERE name='row-8'");
  expect(acceptsLikeOracle(db, empty, [expected])).toBe(false);
});

it("preserves escaping, embedded NUL, quotes and Unicode without normalizing source profiles", () => {
  const db = database();
  const samples = ['"\\\b\f\n\r\t\u0000\u0001\u001f', "é漢字𝄞\u2028\u2029", "a/b\u007f\u0080", "\u{10ffff}"];
  for (let i = 0; i < samples.length; i++) storedRow(db, `row-${i}-${samples[i]}`, `SELECT '${samples[i]}'`);
  const expected = profile(db, empty);
  expect(acceptsLikeOracle(db, empty, [expected])).toBe(true);
  const rows = JSON.parse(expected);
  expect(acceptsLikeOracle(db, empty, [JSON.stringify(rows, null, 2)])).toBe(false);
  expect(acceptsLikeOracle(db, empty, [canonicalJson(rows.map((row: object) => ({ ...row, extra: null })))])).toBe(false);
  expect(acceptsLikeOracle(db, empty, ["not JSON", expected])).toBe(true);
});

it("uses the unchanged oracle for unsupported source row shapes and native BLOB values", () => {
  const db = specimen();
  db.exec("PRAGMA writable_schema=ON; UPDATE sqlite_schema SET sql=X'010203' WHERE name='record_names'");
  const expected = profile(db, empty);
  expect(acceptsLikeOracle(db, empty, [expected])).toBe(true);
  expect(acceptsLikeOracle(db, empty, ["[]"])).toBe(false);
});

it("owns standalone transactions, preserves caller transactions and reads current uncommitted schema", () => {
  const db = specimen(), expected = profile(db, empty), exec = vi.spyOn(db, "exec");
  assertProfile(db, empty, [expected]);
  expect(exec.mock.calls.map(call => call[0])).toEqual(["BEGIN", "COMMIT"]);
  db.exec("BEGIN"); exec.mockClear();
  assertProfile(db, empty, [expected]); expect(exec).not.toHaveBeenCalled();
  db.exec("CREATE VIEW uncommitted AS SELECT 1"); exec.mockClear();
  expect(acceptsLikeOracle(db, empty, [expected])).toBe(false);
  expect(db.isTransaction).toBe(true); expect(exec).not.toHaveBeenCalled();
  db.exec("ROLLBACK"); expect(acceptsLikeOracle(db, empty, [expected])).toBe(true);
  storedRow(db, "oversized", "x".repeat(131073)); exec.mockClear();
  expect(() => assertProfile(db, empty, [expected])).toThrow();
  expect(exec.mock.calls.map(call => call[0])).toEqual(["BEGIN", "ROLLBACK"]);
});

it("retains read-only bytes and catches later external schema drift without caching statements or target verdicts", () => {
  const folder = mkdtempSync(join(tmpdir(), "keryx-schema-profile-")); folders.push(folder);
  const file = join(folder, "synthetic.sqlite"), writer = database(file);
  writer.exec("CREATE TABLE records(id TEXT PRIMARY KEY)");
  const expected = profile(writer, empty), original = readFileSync(file), reader = database(file, true);
  const prepare = vi.spyOn(reader, "prepare");
  assertProfile(reader, empty, [expected]); assertProfile(reader, empty, [expected]);
  expect(prepare).toHaveBeenCalledTimes(4);
  expect(prepare.mock.calls.filter(call => call[0].includes("json_group_array"))).toHaveLength(2);
  expect(readFileSync(file)).toEqual(original);
  writer.exec("CREATE INDEX later_drift ON records(id)");
  expect(acceptsLikeOracle(reader, empty, [expected])).toBe(false);
});
