import { afterAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";
import { SqliteAdapter } from "./sqlite-adapter";

const file = join(tmpdir(), `keryx-archive-stream-${randomUUID()}.sqlite`);
const writer = new DatabaseSync(file);
writer.exec("PRAGMA journal_mode=WAL; CREATE TABLE query_runs(id TEXT PRIMARY KEY, created_at TEXT, data TEXT)");
const insert = writer.prepare("INSERT INTO query_runs VALUES(?, ?, ?)");
for (const id of ["a", "b", "c"]) insert.run(id, "2026-09-01", JSON.stringify({ id }));
const db = new SqliteAdapter(file, { readOnly: true });
afterAll(() => { db.close(); writer.close(); for (const suffix of ["", "-wal", "-shm"]) rmSync(file + suffix, { force: true }); });

describe("SQLite recent query iterator", () => {
  it("keeps one read snapshot across a concurrent insert and orders equal timestamps by id", async () => {
    const ids: string[] = [];
    for await (const run of db.iterateRecentQueries(3)) {
      ids.push(run.id);
      if (ids.length === 1) insert.run("new", "2026-09-02", JSON.stringify({ id: "new" }));
    }
    expect(ids).toEqual(["c", "b", "a"]);
    const fresh: string[] = [];
    for await (const run of db.iterateRecentQueries(2)) fresh.push(run.id);
    expect(fresh).toEqual(["new", "c"]);
  });
  it("releases the read cursor after early termination and parsing failure", async () => {
    for await (const run of db.iterateRecentQueries(3)) { expect(run.id).toBe("new"); break; }
    expect(writer.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get()?.busy).toBe(0);
    insert.run("bad", "2026-09-03", "{");
    await expect((async () => { for await (const run of db.iterateRecentQueries(3)) void run; })()).rejects.toThrow();
    expect(writer.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get()?.busy).toBe(0);
    writer.prepare("DELETE FROM query_runs WHERE id='bad'").run();
  });
  it.each([0, -1, 2501, 1.5, NaN])("refuses invalid limit %s", async limit => {
    await expect((async () => { for await (const run of db.iterateRecentQueries(limit)) void run; })()).rejects.toThrow("Invalid query scan limit");
  });
});
