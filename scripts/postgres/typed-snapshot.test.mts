import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { snapshotRowWire, snapshotRowDigest, snapshotTables, snapshotRows } from "./typed-snapshot.mts";

describe("lossless migration snapshot", () => {
  it("preserves dynamic classes, int64, real bits, binary, invalid UTF-8 and embedded NUL", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`CREATE TABLE sample(a,b,c,d,e,f,g,h);
        INSERT INTO sample VALUES(NULL,9223372036854775807,-9223372036854775808,1.5,x'00ff',CAST(x'00c3ff' AS TEXT),'',1);
        BEGIN;`);
      const table = snapshotTables(db)[0], rows = [...snapshotRows(db, table)];
      expect(rows).toEqual([[["null"], ["integer", "9223372036854775807"], ["integer", "-9223372036854775808"],
        ["real", "3ff8000000000000"], ["blob", "00ff"], ["text", "00c3ff"], ["text", ""], ["integer", "1"]]]);
      expect(snapshotRowDigest(rows[0])).toMatch(/^[0-9a-f]{64}$/);
      expect(snapshotRowDigest(rows[0])).not.toBe(snapshotRowDigest([["integer", "1"], ["text", "31"]]));
    } finally { db.close(); }
  });
  it("handles quoted identifiers and refuses reads outside a consistent transaction", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec('CREATE TABLE "quote"";select"("column"";drop"); INSERT INTO "quote"";select" VALUES(17);');
      expect(() => snapshotTables(db)).toThrow(); db.exec("BEGIN");
      const table = snapshotTables(db)[0]; expect([...snapshotRows(db, table)]).toEqual([[["integer", "17"]]]);
      db.exec("ROLLBACK"); expect(() => [...snapshotRows(db, table)]).toThrow();
    } finally { db.close(); }
  });
  it("refuses generated storage instead of silently omitting data", () => {
    const db = new DatabaseSync(":memory:");
    try { db.exec("CREATE TABLE generated(a,b GENERATED ALWAYS AS (a+1)); BEGIN;"); expect(() => snapshotTables(db)).toThrow(); }
    finally { db.close(); }
  });
  it.each([
    [], [["null", ""]], [["integer", "01"]], [["integer", "-0"]], [["integer", "9223372036854775808"]],
    [["integer", "-9223372036854775809"]], [["text", "FF"]], [["blob", "a"]], [["real", "7ff0000000000000"]],
    [["real", "7ff8000000000000"]], [["unknown", ""]], [["integer", 1]],
  ].map(value => ({ value })))("rejects malformed or inexact row encoding: $value", ({ value }) => expect(() => snapshotRowWire(value)).toThrow());
});
