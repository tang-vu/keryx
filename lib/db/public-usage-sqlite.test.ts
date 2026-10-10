import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createSqlitePublicUsage } from "./public-usage-sqlite";
import { createTrustedUsageContext, newRunUsage } from "../research/usage-provenance";
import { UsageUnavailable, usageWindow } from "../usage/contracts";
const network = "eip155:5042", wallet = `0x${"a".repeat(40)}`, proof = "a".repeat(64);
const window = usageWindow(new URLSearchParams(), network, new Date("2026-10-11T00:00:00.000Z"));
let db: DatabaseSync; afterEach(() => db?.close());
function fixture() {
  db = new DatabaseSync(":memory:"); db.exec(`CREATE TABLE query_runs(id TEXT PRIMARY KEY,created_at TEXT,asker TEXT,data TEXT);
    CREATE TABLE payment_events(id TEXT,query_id TEXT,network TEXT,kind TEXT,amount_usdc REAL,settled INTEGER,settlement_status TEXT,tx_hash TEXT,payee TEXT);`);
  const insert = db.prepare("INSERT INTO query_runs VALUES(?,?,?,?)");
  return (id: string, cohort: "outside" | "scripted" | "unknown", time = "2026-10-10T00:00:00.000Z") => {
    const usage = newRunUsage({ usageContext: createTrustedUsageContext(network, { actor: cohort === "outside" ? "outside" : "unknown",
      funding: "unknown", scripted: cohort === "scripted", ...(cohort === "outside" ? { actorEvidenceSha256: proof } : {}) }) }, network, []);
    insert.run(id, time, wallet, JSON.stringify({ id, createdAt: time, usage, question: "Synthetic public question", answer: "Synthetic body",
      provenance: { version: 1, surface: "api", ownershipMethod: "unknown" } }));
  };
}
describe("ordinary SQLite public usage", () => {
  it("filters scripted/outside BEFORE bounded page selection and preserves original rows/schema", async () => {
    const save = fixture(); save("outside-old", "outside", "2026-10-01T00:00:00.000Z");
    for (let i = 0; i < 120; i++) save(`scripted-${i}`, "scripted"); save("unknown", "unknown");
    const before = JSON.stringify(db.prepare("SELECT * FROM query_runs ORDER BY id").all());
    const schema = JSON.stringify(db.prepare("SELECT sql FROM sqlite_schema ORDER BY name").all());
    const store = createSqlitePublicUsage(db);
    expect((await store.history(window, "outside", 1)).map(run => run.id)).toEqual(["outside-old"]);
    expect((await store.history(window, "default", 50)).map(run => run.id)).toEqual(["unknown", "outside-old"]);
    expect((await store.summary(window)).columns.map(c => c.researchRuns)).toEqual([1, 0, 120, 1]);
    expect(JSON.stringify(db.prepare("SELECT * FROM query_runs ORDER BY id").all())).toBe(before);
    expect(JSON.stringify(db.prepare("SELECT sql FROM sqlite_schema ORDER BY name").all())).toBe(schema);
  });
  it("refuses excessive corpus/invalid page bounds and later native markers", async () => {
    const save = fixture(); save("one", "unknown"); const store = createSqlitePublicUsage(db);
    await expect(store.history(window, "outside", 101)).rejects.toThrow(UsageUnavailable);
    db.exec("CREATE TABLE keryx_storage_identity(unknown TEXT)");
    expect(() => createSqlitePublicUsage(db)).toThrow(); await expect(store.summary(window)).rejects.toThrow();
    db.exec("DROP TABLE keryx_storage_identity");
    db.exec("BEGIN"); for (let i = 0; i < 10000; i++) save(String(i), "unknown"); db.exec("COMMIT");
    await expect(store.summary(window)).rejects.toThrow(UsageUnavailable);
  });
});
