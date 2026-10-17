import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { sqliteSchemaMatches, type SqliteSchemaExpectation } from "./sqlite-schema-match";
import { assertGatewayFundingSchema, gatewayFundingFenceStatements, GATEWAY_FUNDING_INDEXES, GATEWAY_FUNDING_SCHEMA } from "./gateway-funding-sqlite-schema";
import { assertStorageFences, insertStorageIdentity, installStorageFences, restrictStorageApplicationSql } from "./storage-identity-sqlite";
import { syntheticStorageIdentity } from "./storage-identity-fixture";

const schemaSnapshot = (db: DatabaseSync) => db.prepare("SELECT type,name,sql FROM sqlite_schema ORDER BY type,name").all();

it("reads exact names, object kinds and original SQL without writes or cached authority", () => {
  const db = new DatabaseSync(":memory:");
  const table = "CREATE TABLE sources(id TEXT PRIMARY KEY)", index = "CREATE INDEX source_lookup ON sources(id)";
  const trigger = "CREATE TRIGGER source_guard BEFORE DELETE ON sources BEGIN SELECT RAISE(ABORT,'guard'); END";
  const original: SqliteSchemaExpectation[] = [["sources", "table", table], ["source_lookup", "index", index], ["source_guard", "trigger", trigger]];
  try {
    db.exec(table); db.exec(index); db.exec(trigger);
    const before = schemaSnapshot(db);
    expect(sqliteSchemaMatches(db, original)).toBe(true);
    expect(sqliteSchemaMatches(db, [["source_guard", "index", trigger]])).toBe(false);
    expect(sqliteSchemaMatches(db, [["wrong_name", "trigger", trigger]])).toBe(false);
    expect(sqliteSchemaMatches(db, [["source_guard", "trigger", trigger.replace("'guard'", "'different guard'")]])).toBe(false);
    expect(schemaSnapshot(db)).toEqual(before);
    db.exec("DROP TRIGGER source_guard");
    expect(sqliteSchemaMatches(db, original)).toBe(false);
    db.exec(trigger.replace("'guard'", "'different guard'"));
    expect(sqliteSchemaMatches(db, original)).toBe(false);
    db.exec("DROP TRIGGER source_guard"); db.exec(trigger);
    restrictStorageApplicationSql(db);
    expect(sqliteSchemaMatches(db, original)).toBe(true);
    expect(schemaSnapshot(db)).toEqual(before);
  } finally { db.close(); }
});

it("retains funding partial/extra/schema/index/domain-trigger refusals without repair", () => {
  const db = new DatabaseSync(":memory:");
  try {
    expect(gatewayFundingFenceStatements(db)).toEqual({});
    expect(() => assertGatewayFundingSchema(db)).toThrow();
    for (const sql of Object.values(GATEWAY_FUNDING_SCHEMA)) db.exec(sql);
    for (const sql of Object.values(GATEWAY_FUNDING_INDEXES)) db.exec(sql);
    const fences = gatewayFundingFenceStatements(db);
    for (const sql of Object.values(fences)) db.exec(sql);
    const before = schemaSnapshot(db);
    expect(() => assertGatewayFundingSchema(db)).not.toThrow();
    expect(schemaSnapshot(db)).toEqual(before);
    const [name, sql] = Object.entries(fences)[0];
    db.exec(`DROP TRIGGER "${name}"`);
    expect(() => assertGatewayFundingSchema(db)).toThrow();
    db.exec(sql.replace("funding domain writer required", "changed guard"));
    expect(() => assertGatewayFundingSchema(db)).toThrow();
    db.exec(`DROP TRIGGER "${name}"`); db.exec(sql);
    db.exec("DROP INDEX gateway_funding_observations_slot_kind");
    expect(() => assertGatewayFundingSchema(db)).toThrow();
    db.exec("CREATE INDEX gateway_funding_observations_slot_kind ON gateway_funding_observations(operation_id,step)");
    expect(() => assertGatewayFundingSchema(db)).toThrow();
    db.exec("DROP INDEX gateway_funding_observations_slot_kind"); db.exec(GATEWAY_FUNDING_INDEXES.gateway_funding_observations_slot_kind);
    db.exec("CREATE TABLE gateway_funding_extra(id TEXT)");
    expect(() => assertGatewayFundingSchema(db)).toThrow();
    db.exec("DROP TABLE gateway_funding_extra");
    expect(() => assertGatewayFundingSchema(db)).not.toThrow();
    expect(schemaSnapshot(db)).toEqual(before);
  } finally { db.close(); }
});

it("retains storage writer and marker-guard drift refusals on every read", () => {
  const db = new DatabaseSync(":memory:"), identity = syntheticStorageIdentity("testnet-real");
  try {
    insertStorageIdentity(db, identity); db.exec("CREATE TABLE sources(id TEXT PRIMARY KEY)"); installStorageFences(db, identity);
    expect(() => assertStorageFences(db, identity)).not.toThrow();
    for (const [pattern, reason] of [["storage_fence_%", "fence_missing_or_changed"], ["storage_identity_no_update", "marker_guard_missing_or_changed"]]) {
      const { name, sql } = db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name LIKE ? LIMIT 1").get(pattern) as { name: string; sql: string };
      db.exec(`DROP TRIGGER "${name}"`);
      expect(() => assertStorageFences(db, identity)).toThrow(reason);
      db.exec(`CREATE TRIGGER "${name}" BEFORE DELETE ON sources BEGIN SELECT RAISE(ABORT,'changed'); END`);
      expect(() => assertStorageFences(db, identity)).toThrow(reason);
      db.exec(`DROP TRIGGER "${name}"`); db.exec(sql);
      const before = schemaSnapshot(db);
      expect(() => assertStorageFences(db, identity)).not.toThrow();
      expect(schemaSnapshot(db)).toEqual(before);
    }
  } finally { db.close(); }
});

it("refuses NULL SQL even for an implicit index or NULL expectation", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE unique_fixture(value TEXT UNIQUE)");
    const row = db.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND sql IS NULL").get()!;
    expect(sqliteSchemaMatches(db, [[String(row.name), "index", ""]])).toBe(false);
    expect(sqliteSchemaMatches(db, [[String(row.name), "index", null as unknown as string]])).toBe(false);
    expect(sqliteSchemaMatches(db, [["missing", "table", null as unknown as string]])).toBe(false);
    expect(sqliteSchemaMatches(db, [])).toBe(true);
  } finally { db.close(); }
});

it("keeps native schema writing disabled after a writable_schema request", () => {
  const db = new DatabaseSync(":memory:"), sql = "CREATE TABLE sealed_fixture(id TEXT)";
  try {
    db.exec(sql); db.exec("PRAGMA writable_schema=ON");
    expect(() => db.prepare("INSERT INTO sqlite_schema(type,name,tbl_name,rootpage,sql) VALUES('table','sealed_fixture','sealed_fixture',0,?)").run(sql + " ")).toThrow("may not be modified");
    expect(sqliteSchemaMatches(db, [["sealed_fixture", "table", sql]])).toBe(true);
  } finally { db.close(); }
});

it("keeps first-row semantics for duplicate names/kinds and NULL definitions inside SQLite", () => {
  const db = new DatabaseSync(":memory:");
  // Modern SQLite refuses forged sqlite_schema rows. Run the same native query
  // over a synthetic metadata table to exercise duplicate/corrupt-row semantics.
  const fixture = { prepare: (sql: string) => db.prepare(sql.replaceAll("sqlite_schema", "schema_fixture")) } as unknown as DatabaseSync;
  const sql = "CREATE TABLE source(value TEXT)", laterSql = sql + " ";
  try {
    db.exec("CREATE TABLE schema_fixture(name TEXT,type TEXT,sql TEXT)");
    const insert = db.prepare("INSERT INTO schema_fixture(rowid,name,type,sql) VALUES(?,?,?,?)");
    insert.run(40, "source", "table", sql);
    insert.run(-2, "source", "table", laterSql);
    insert.run(-3, "source", "trigger", sql);
    expect(sqliteSchemaMatches(fixture, [["source", "table", sql]])).toBe(false);
    expect(sqliteSchemaMatches(fixture, [["source", "table", laterSql]])).toBe(true);
    expect(sqliteSchemaMatches(fixture, [["source", "trigger", sql]])).toBe(true);
    expect(sqliteSchemaMatches(fixture, [["source", "index", sql]])).toBe(false);
    expect(sqliteSchemaMatches(fixture, [["Source", "table", laterSql]])).toBe(false);
    db.prepare("UPDATE schema_fixture SET sql=NULL WHERE rowid=-2").run();
    expect(sqliteSchemaMatches(fixture, [["source", "table", sql]])).toBe(false);
    expect(sqliteSchemaMatches(fixture, [["source", "table", null as unknown as string]])).toBe(false);
    db.prepare("DELETE FROM schema_fixture WHERE rowid=-2").run();
    expect(sqliteSchemaMatches(fixture, [["source", "table", sql], ["source", "table", sql]])).toBe(true);
    expect(sqliteSchemaMatches(fixture, [["source", "table", sql], ["source", "table", laterSql]])).toBe(false);
    expect(sqliteSchemaMatches(fixture, [["source"]] as unknown as SqliteSchemaExpectation[])).toBe(false);
    expect(sqliteSchemaMatches(fixture, [[null, "table", sql]] as unknown as SqliteSchemaExpectation[])).toBe(false);
  } finally { db.close(); }
});

it("observes fresh SQL after repeated success and treats stored/expected SQL as exact data", () => {
  const db = new DatabaseSync(":memory:");
  const sql = "CREATE TABLE exact_fixture(value TEXT DEFAULT '??c; DROP TABLE sentinel; --')";
  const expected: SqliteSchemaExpectation[] = [["exact_fixture", "table", sql]];
  try {
    db.exec("CREATE TABLE sentinel(id TEXT)"); db.exec(sql);
    const before = schemaSnapshot(db);
    for (let i = 0; i < 20; i++) expect(sqliteSchemaMatches(db, expected)).toBe(true);
    expect(sqliteSchemaMatches(db, [["exact_fixture", "table", sql + " "]])).toBe(false);
    expect(sqliteSchemaMatches(db, [["exact_fixture", "table", sql.replace("??c", "doc")]])).toBe(false);
    expect(sqliteSchemaMatches(db, [["exact_fixture", "table", "SELECT 1; DROP TABLE sentinel"]])).toBe(false);
    expect(schemaSnapshot(db)).toEqual(before);
    db.exec("DROP TABLE exact_fixture");
    db.exec(sql.replace("??c", "changed"));
    expect(sqliteSchemaMatches(db, expected)).toBe(false);
    db.exec("DROP TABLE exact_fixture"); db.exec(sql);
    expect(sqliteSchemaMatches(db, expected)).toBe(true);
    expect(schemaSnapshot(db)).toEqual(before);
  } finally { db.close(); }
});
