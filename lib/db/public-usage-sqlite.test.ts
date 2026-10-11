import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createSqlitePublicUsage } from "./public-usage-sqlite";
import { createSqliteRunPrivacy,RUN_PRIVACY_SQL } from "./run-privacy-sqlite";
import { createTrustedUsageContext, newRunUsage } from "../research/usage-provenance";
import { UsageUnavailable, usageWindow } from "../usage/contracts";
import {installSqliteApplicationSchema} from "./sqlite-application-schema";
const network = "eip155:5042", wallet = `0x${"a".repeat(40)}`, proof = "a".repeat(64);
const window = usageWindow(new URLSearchParams(), network, new Date("2026-10-11T00:00:00.000Z"));
let db: DatabaseSync; afterEach(() => db?.close());
function fixture() {
  db = new DatabaseSync(":memory:"); installSqliteApplicationSchema(db);
  db.exec(RUN_PRIVACY_SQL);db.prepare("INSERT INTO run_privacy_defaults VALUES(?,?)").run(wallet,"public");
  const insert = db.prepare("INSERT INTO query_runs(id,created_at,asker,data) VALUES(?,?,?,?)");
  return (id: string, cohort: "outside" | "scripted" | "unknown", time = "2026-10-10T00:00:00.000Z") => {
    const usage = newRunUsage({ usageContext: createTrustedUsageContext(network, { actor: cohort === "outside" ? "outside" : "unknown",
      funding: "unknown", scripted: cohort === "scripted", ...(cohort === "outside" ? { actorEvidenceSha256: proof } : {}) }) }, network, []);
    insert.run(id, time, wallet, JSON.stringify({ id, createdAt: time, usage, question: "Synthetic public question", answer: "Synthetic body",
      budget:0,engine:"heuristic",totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[],
      provenance: { version: 1, surface: "api", ownershipMethod: "unknown" } }));
  };
}
describe("ordinary SQLite public usage", () => {
  it("filters scripted/outside BEFORE bounded page selection and preserves original rows/schema", async () => {
    const save = fixture(); save("outside-old", "outside", "2026-10-01T00:00:00.000Z");
    const pay = db.prepare("INSERT INTO payment_events(id,query_id,network,kind,amount_usdc,settled,settlement_status,tx_hash,payee) VALUES(?,?,?,?,?,?,?,?,?)");
    for (let i = 0; i < 2100; i++) {
      save(`scripted-${i}`, "scripted");
      pay.run(`payment-${i}`, `scripted-${i}`, network, "fetch", 0.000001, 1, "settled", "synthetic-recorded-reference", wallet);
    }
    save("unknown", "unknown");
    const before = JSON.stringify(db.prepare("SELECT * FROM query_runs ORDER BY id").all());
    const paymentsBefore = JSON.stringify(db.prepare("SELECT * FROM payment_events ORDER BY id").all());
    const schema = JSON.stringify(db.prepare("SELECT sql FROM sqlite_schema ORDER BY name").all());
    const store = createSqlitePublicUsage(db,()=>createSqliteRunPrivacy(db));
    expect((await store.history(window, "outside", 1)).map(run => run.id)).toEqual(["outside-old"]);
    expect((await store.history(window, "default", 50)).map(run => run.id)).toEqual(["unknown", "outside-old"]);
    const summary = await store.summary(window);
    expect(summary.columns.map(c => c.researchRuns)).toEqual([1, 0, 2100, 1]);
    expect(summary.columns[2]).toMatchObject({ payingRuns: 2100, unknownFundingPayingRuns: 2100, settledPayments: 2100, settledMicros: "2100" });
    expect(JSON.stringify(db.prepare("SELECT * FROM query_runs ORDER BY id").all())).toBe(before);
    expect(JSON.stringify(db.prepare("SELECT * FROM payment_events ORDER BY id").all())).toBe(paymentsBefore);
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
