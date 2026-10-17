import { expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { restrictStorageApplicationSql } from "./storage-identity-sqlite";

it("restores fixed allocation metadata denial when one captured native query fails", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE synthetic(value TEXT)");
    const allocation = restrictStorageApplicationSql(db), prepare = db.prepare.bind(db);
    expect(allocation()).toBeGreaterThan(0);
    const intercepted = vi.spyOn(db, "prepare").mockImplementation(sql => {
      if (sql === "PRAGMA page_size") throw new Error("Synthetic fixed metadata failure");
      return prepare(sql);
    });
    try { expect(() => allocation()).toThrow("Synthetic fixed metadata failure"); }
    finally { intercepted.mockRestore(); }
    for (const sql of ["PRAGMA page_count", "PRAGMA page_size", "PRAGMA page_size=8192"])
      expect(() => db.prepare(sql).get()).toThrow();
    expect(allocation()).toBeGreaterThan(0);
    expect(() => db.exec("ATTACH ':memory:' AS other")).toThrow();
  } finally { db.close(); }
});
