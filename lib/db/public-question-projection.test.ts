import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import type { QueryRun } from "../types";
import { readSqlitePublicQuestions } from "./public-question-projection";
import { PrivacyError } from "../run-privacy/contracts";
import { createSqliteRunPrivacy, RUN_PRIVACY_SQL } from "./run-privacy-sqlite";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { writeSqliteQueryRun } from "./query-run-record";

const connections: DatabaseSync[] = [];
afterEach(() => { for (const db of connections.splice(0)) db.close(); });
function run(id = "public", question = "Canonical public question"): QueryRun {
  return { id, createdAt: "2026-11-04T00:00:00Z", question, answer: "ANSWER_SENTINEL", budget: 0.03, engine: "synthetic",
    totalSpent: 0.012345, totalToCreators: 0.000001, subClaims: [], decisions: [], citations: [], trace: [], unknown: "IGNORED_SENTINEL" } as QueryRun;
}
function fixture() {
  const db = new DatabaseSync(":memory:"); connections.push(db);
  db.exec("CREATE TABLE query_runs(id TEXT PRIMARY KEY,created_at TEXT,data TEXT,question TEXT); CREATE TABLE run_privacy(run_id TEXT PRIMARY KEY,visibility TEXT,erased INTEGER)");
  function add(value: QueryRun, visibility = "public", erased = 0) {
    db.prepare("INSERT INTO query_runs VALUES(?,?,?,?)").run(value.id, value.createdAt, JSON.stringify(value), "SHADOW_SENTINEL");
    db.prepare("INSERT INTO run_privacy VALUES(?,?,?)").run(value.id, visibility, erased);
  }
  function replace(id: string, data: unknown) { db.prepare("UPDATE query_runs SET data=? WHERE id=?").run(typeof data === "string" ? data : JSON.stringify(data), id); }
  return { db, add, replace };
}

it.each(["Unicode tiếng Việt 🌍", "a\ud800b", "a\udc00b", 'quote " and backslash \\', "line\nnext"])(
  "preserves canonical JSON text exactly and ignores the shadow question: %s", question => {
    const f = fixture(); f.add(run("public", question));
    expect(readSqlitePublicQuestions(f.db, ["public"])).toEqual([{ id: "public", question }]);
  });

it("reads one bounded batch without exporting answer, arrays or unrelated original fields", () => {
  const f = fixture();
  for (let index = 0; index < 32; index++) f.add({ ...run("run_" + index), trace: [{ text: "TRACE_SENTINEL".repeat(20_000) }] } as unknown as QueryRun);
  let calls = 0, rawOutput = "";
  const guarded = { prepare(query: string) { calls++; const statement = f.db.prepare(query);
    return { all(...args: Parameters<typeof statement.all>) { const rows = statement.all(...args); rawOutput = JSON.stringify(rows); return rows; } };
  } } as unknown as DatabaseSync;
  const ids = Array.from({ length: 32 }, (_, index) => "run_" + index);
  const before = f.db.prepare("SELECT total_changes() n").get()!.n;
  const values = readSqlitePublicQuestions(guarded, ids);
  expect(values).toHaveLength(32); expect(calls).toBe(1);
  expect(values.every(value => Object.keys(value).sort().join(",") === "id,question")).toBe(true);
  for (const sentinel of ["ANSWER_SENTINEL", "TRACE_SENTINEL", "IGNORED_SENTINEL", "SHADOW_SENTINEL"]) expect(rawOutput).not.toContain(sentinel);
  expect(rawOutput.length).toBeLessThan(32_000);
  expect(f.db.prepare("SELECT total_changes() n").get()!.n).toBe(before);
});

it("filters private, unlisted, erased, absent-policy and unknown rows before inspecting original JSON", () => {
  const f = fixture(); f.add(run());
  for (const [id, visibility, erased] of [["private", "private", 0], ["unlisted", "unlisted", 0], ["erased", "public", 1], ["orphan", "public", 0]] as const) {
    f.add(run(id, "PRIVATE_SENTINEL"), visibility, erased); f.replace(id, "malformed PRIVATE_SENTINEL");
  }
  f.db.prepare("DELETE FROM run_privacy WHERE run_id='orphan'").run();
  expect(readSqlitePublicQuestions(f.db, ["private", "unlisted", "erased", "orphan", "missing", "public"]))
    .toEqual([{ id: "public", question: "Canonical public question" }]);
});

it.each([
  { id: "other" }, { createdAt: 1 }, { question: [] }, { answer: {} }, { budget: true }, { engine: null },
  { totalSpent: "0" }, { totalToCreators: null }, { subClaims: {} }, { decisions: null }, { citations: "[]" }, { trace: false },
])("refuses a malformed required original field without returning a partial question: %j", change => {
  const f = fixture(); f.add(run()); f.replace("public", { ...run(), ...change });
  expect(() => readSqlitePublicQuestions(f.db, ["public"])).toThrow(PrivacyError);
});

it.each(["question", "id", "trace"])("refuses duplicate essential JSON keys, including %s", key => {
  const f = fixture(); f.add(run());
  f.replace("public", JSON.stringify(run()).replace(/^\{/u, `{${JSON.stringify(key)}:${JSON.stringify(run()[key as keyof QueryRun])},`));
  expect(() => readSqlitePublicQuestions(f.db, ["public"])).toThrow("privacy_unavailable");
});

it.each(["malformed", "[]", "{}", '{"id":"public","budget":1e999}'])("refuses missing/invalid canonical originals: %s", data => {
  const f = fixture(); f.add(run()); f.replace("public", data);
  expect(() => readSqlitePublicQuestions(f.db, ["public"])).toThrow("privacy_unavailable");
});

it("refuses an oversized original and an absent required field without materializing its trace", () => {
  const f = fixture(); f.add(run()); f.replace("public", { ...run(), trace: ["x".repeat(4_000_001)] });
  expect(() => readSqlitePublicQuestions(f.db, ["public"])).toThrow("privacy_unavailable");
  const missing = { ...run() } as Partial<QueryRun>; delete missing.question; f.replace("public", missing);
  expect(() => readSqlitePublicQuestions(f.db, ["public"])).toThrow("privacy_unavailable");
});

it("bounds input before SQL, deduplicates exact IDs, and preserves native refusal identity", () => {
  const f = fixture(); f.add(run());
  expect(readSqlitePublicQuestions(f.db, ["public", "public"])).toHaveLength(1);
  const refusal = new PrivacyError("privacy_unavailable");
  const denied = { prepare() { throw refusal; } } as unknown as DatabaseSync;
  expect(readSqlitePublicQuestions(denied, [])).toEqual([]);
  for (const ids of [Array(33).fill("public"), ["bad id"], ["x".repeat(129)]])
    expect(() => readSqlitePublicQuestions(denied, ids)).toThrow("privacy_unavailable");
  try { readSqlitePublicQuestions(denied, ["public"]); throw Error("Expected refusal"); }
  catch (error) { expect(error).toBe(refusal); }
});

it("uses the real ordinary privacy guard and freshly retracts/erases public questions without financial rewrites", async () => {
  const db = new DatabaseSync(":memory:"); connections.push(db); installSqliteApplicationSchema(db); db.exec(RUN_PRIVACY_SQL);
  const store = createSqliteRunPrivacy(db), wallet = `0x${"a".repeat(40)}`, sessionHash = "a".repeat(64), now = Date.now();
  const actor = { wallet, sessionHash, binding: { network: "eip155:5042002" as const, origin: "https://synthetic.example" } };
  db.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(sessionHash, wallet, now - 1000, now + 60_000);
  writeSqliteQueryRun(db, { ...run(), asker: wallet }, false);
  await store.change("public", actor, { visibility: "public", revision: 0, requestId: randomUUID() });
  const financial = db.prepare("SELECT id,total_spent,total_to_creators FROM query_runs").all();
  expect(await store.questions!(["public"])).toEqual([{ id: "public", question: run().question }]);
  await store.change("public", actor, { visibility: "unlisted", revision: 1, requestId: randomUUID() });
  expect(await store.questions!(["public"])).toEqual([]);
  await store.change("public", actor, { visibility: "public", revision: 2, requestId: randomUUID() });
  expect(await store.questions!(["public"])).toHaveLength(1);
  await store.erase("public", actor, { revision: 3, requestId: randomUUID() });
  expect(await store.questions!(["public"])).toEqual([]);
  expect(db.prepare("SELECT id,total_spent,total_to_creators FROM query_runs").all()).toEqual(financial);
  db.exec("DROP TRIGGER run_privacy_audit_no_update");
  await expect(store.questions!(["public"])).rejects.toThrow("privacy_unavailable");
});
