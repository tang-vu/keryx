import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { QueryRun } from "../types";
import { createEnrolledSqliteRunPrivacy, createSqliteRunPrivacy, RUN_PRIVACY_SQL } from "./run-privacy-sqlite";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { writeSqliteQueryRun } from "./query-run-record";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { insertStorageIdentity, installStorageFences } from "./storage-identity-sqlite";
import { openVerifiedSqliteStorage } from "./storage-identity-connection";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import type { NativeLearningReadCounts } from "../../scripts/measure-enrolled-source-learning.mjs";

const opened: Array<{ close(): void }> = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });
function run(id = "public", overrides: Partial<QueryRun> = {}): QueryRun {
  return { id, createdAt: "2026-11-09T00:00:00.000Z", question: "QUESTION_SENTINEL", answer: "ANSWER_SENTINEL",
    engine: "synthetic", budget: 0, totalSpent: 0, totalToCreators: 0, subClaims: [], citations: [],
    decisions: [{ sourceId: "source_a", sourceName: "SOURCE_NAME_SENTINEL", action: "SKIP", price: 0,
      expectedValue: 0, confidence: 0, targets: [], rationale: "RATIONALE_SENTINEL" }],
    trace: [{ phase: "fetch", message: "TRACE_SENTINEL", ts: 0 }], paymentMode: "offline", ...overrides };
}
function fixture() {
  const db = new DatabaseSync(":memory:"); opened.push(db); installSqliteApplicationSchema(db); db.exec(RUN_PRIVACY_SQL);
  const privacy = createSqliteRunPrivacy(db);
  const add = (value: QueryRun, visibility = "public", erased = 0) => {
    writeSqliteQueryRun(db, value, false);
    db.prepare("UPDATE run_privacy SET visibility=?,erased=? WHERE run_id=?").run(visibility, erased, value.id);
  };
  const replace = (id: string, value: unknown) => db.prepare("UPDATE query_runs SET data=? WHERE id=?")
    .run(typeof value === "string" ? value : JSON.stringify(value), id);
  return { db, privacy, add, replace };
}

it("keeps only learning inputs and never returns question, answer, trace, citation or decision prose", async () => {
  const f = fixture(); f.add(run("public", { question: "QUESTION_SENTINEL".repeat(20000), answer: "ANSWER_SENTINEL".repeat(50000) }));
  const before = f.db.prepare("SELECT * FROM query_runs").all();
  const page = await f.privacy.learningPage!({ take: 32 });
  expect(page).toHaveLength(1); expect(page[0]).toMatchObject({ id: "public", paymentMode: "offline", decisions: [{ sourceId: "source_a" }] });
  const text = JSON.stringify(page);
  for (const secret of ["QUESTION_SENTINEL", "ANSWER_SENTINEL", "TRACE_SENTINEL", "SOURCE_NAME_SENTINEL", "RATIONALE_SENTINEL"])
    expect(text).not.toContain(secret);
  expect(text.length).toBeLessThan(1000); expect(f.db.prepare("SELECT * FROM query_runs").all()).toEqual(before);
});

it("chooses fresh public non-erased rows before its limit and orders ties exactly like the full reader", async () => {
  const f = fixture();
  for (let index = 0; index < 320; index++) f.add(run(`hidden_${index}`, { createdAt: "2026-11-10T00:00:00.000Z" }), index % 2 ? "private" : "unlisted");
  f.add(run("erased"), "public", 1);
  for (let index = 0; index < 70; index++) f.add(run(`public_${String(index).padStart(2, "0")}`));
  const first = await f.privacy.learningPage!({ take: 32 });
  expect(first.map(row => row.id)).toEqual((await f.privacy.list({ take: 32 })).map(row => row.id));
  const last = first.at(-1)!, before = { id: last.id, createdAt: last.createdAt };
  f.db.prepare("UPDATE run_privacy SET visibility='private',revision=revision+1 WHERE run_id='public_37'").run();
  const second = await f.privacy.learningPage!({ take: 32, before });
  expect(second.map(row => row.id)).toEqual((await f.privacy.list({ take: 32, before })).map(row => row.id));
  expect(second.some(row => row.id === "public_37")).toBe(false);
  f.db.prepare("UPDATE run_privacy SET visibility='private',revision=revision+1 WHERE run_id LIKE 'public_%'").run();
  expect(await f.privacy.learningPage!({ take: 32 })).toEqual([]);
});

it.each([0, 33, 1.5, NaN])("refuses an unbounded or invalid page size %s", async take => {
  const f = fixture(); await expect(f.privacy.learningPage!({ take })).rejects.toThrow("privacy_unavailable");
});

it.each([{ question: 17 }, { answer: {} }, { trace: null }, { citations: {} }, { budget: null }, { id: "other" }, { createdAt: "different" }])
  ("refuses an invalid original envelope without inventing empty observations: %j", async patch => {
    const f = fixture(); f.add(run()); f.replace("public", { ...run(), ...patch });
    await expect(f.privacy.learningPage!({ take: 32 })).rejects.toThrow("privacy_unavailable");
  });

it("refuses duplicate fields, invalid JSON, oversized bodies and null decisions", async () => {
  const f = fixture(); f.add(run());
  for (const value of ['{"id":"duplicate",'+JSON.stringify(run()).slice(1), '{"id":',
    JSON.stringify(run("public", { answer: "x".repeat(4_000_000) })), { ...run(), decisions: [null] }]) {
    f.replace("public", value); await expect(f.privacy.learningPage!({ take: 32 })).rejects.toThrow("privacy_unavailable");
  }
});

it("retains the scalar reader's revision refusal rather than treating a malformed public state as a grant", async () => {
  const f = fixture(); f.add(run());
  f.db.exec("PRAGMA ignore_check_constraints=ON");
  f.db.prepare("UPDATE run_privacy SET revision=-1 WHERE run_id='public'").run();
  f.db.exec("PRAGMA ignore_check_constraints=OFF");
  await expect(f.privacy.read("public")).rejects.toThrow();
  await expect(f.privacy.learningPage!({ take: 32 })).rejects.toThrow("privacy_unavailable");
});

it("reduces original fulfillment to its existing truthiness without materializing its original", async () => {
  const f = fixture(); f.add(run());
  for (const originalFulfillment of [{ privateOriginal: "ORIGINAL_SENTINEL" }, [], "ORIGINAL_SENTINEL", "0", true, 1, null, false, 0, "", "\u0000ORIGINAL_SENTINEL"]) {
    f.replace("public", { ...run(), originalFulfillment });
    const rows = await f.privacy.learningPage!({ take: 1 });
    expect(rows[0].originalFulfillment).toBe(!!originalFulfillment); expect(JSON.stringify(rows)).not.toContain("ORIGINAL_SENTINEL");
  }
});

describe("genuine enrolled source-learning privacy pages", () => {
  let directory: string, template: string, identity: StorageIdentity, index = 0;
  const wallet = `0x${"a".repeat(40)}`, sessionHash = "a".repeat(64);
  const actor = { wallet, sessionHash, binding: { network: "eip155:5042" as const, origin: "https://synthetic-learning.invalid" } };
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "keryx-synthetic-learning-")); template = join(directory, "template.sqlite");
    identity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1",
      network: actor.binding.network, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
    const db = new DatabaseSync(template), now = Date.now();
    try {
      db.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(db); installNativeUserDomainSchema(db);
      writeSqliteQueryRun(db, run("native_public", { asker: wallet }), false);
      db.prepare("UPDATE run_privacy SET visibility='public' WHERE run_id='native_public'").run();
      db.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(sessionHash, wallet, now - 2000, now + 600_000);
      insertStorageIdentity(db, identity); installStorageFences(db, identity); db.exec("COMMIT");
    } finally { db.close(); }
  });
  afterAll(() => {
    const target = resolve(directory), base = resolve(tmpdir()), child = relative(base, target);
    if (!child || isAbsolute(child) || child === ".." || child.startsWith(".." + sep)) throw Error("Fixture escaped owned temp root");
    rmSync(target, { recursive: true });
  });
  function native(readOnly = true, runtimeGuard?: () => void) {
    const file = join(directory, "case-" + ++index + ".sqlite"); copyFileSync(template, file);
    const connection = openVerifiedSqliteStorage(file, identity, { readOnly, runtimeGuard, applicationProfiles: supportedSqliteApplicationProfiles(true) });
    opened.push(connection); return { file, connection, privacy: createEnrolledSqliteRunPrivacy(connection.db) };
  }
  it("performs fresh guarded reads on the same readonly native connection without changing original bytes", async () => {
    let guards = 0; const f = native(true, () => { guards++; }), original = readFileSync(f.file);
    const sql: string[] = [], prepare = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function(this: DatabaseSync, query: string) { sql.push(query); return prepare.call(this, query); };
    let page;
    try { page = await f.privacy.learningPage!({ take: 32 }); } finally { DatabaseSync.prototype.prepare = prepare; }
    const counts: NativeLearningReadCounts = { nativePrepares: sql.length,
      schemaReads: sql.filter(query => /FROM sqlite_(?:schema|master)\b/.test(query)).length,
      queryDataReads: sql.filter(query => query.includes("q.data")).length,
      projectionReads: sql.filter(query => query.includes("keryx_source_learning_projection_v1")).length };
    expect(counts.projectionReads).toBe(1); expect(counts.queryDataReads).toBe(1);
    expect(counts.schemaReads).toBeGreaterThan(0); expect(counts.nativePrepares).toBeGreaterThan(1);
    expect(page.map(row => row.id)).toEqual(["native_public"]);
    const start = guards;
    expect(guards).toBeGreaterThan(0);
    expect(await f.privacy.learningPage!({ take: 32 })).toHaveLength(1); expect(guards).toBeGreaterThan(start);
    expect(readFileSync(f.file)).toEqual(original);
    const raw = new DatabaseSync(f.file, { readOnly: true }); opened.push(raw);
    expect(() => createSqliteRunPrivacy(raw)).toThrow(); expect(() => createEnrolledSqliteRunPrivacy(raw)).toThrow();
  });
  it("refuses and retires current native admission revoked before the next call", async () => {
    let refused = false; const f = native(true, () => { if (refused) throw Error("Synthetic current guard refusal"); });
    expect(await f.privacy.learningPage!({ take: 1 })).toHaveLength(1); refused = true;
    await expect(f.privacy.learningPage!({ take: 1 })).rejects.toThrow("privacy_unavailable"); refused = false;
    await expect(f.privacy.learningPage!({ take: 1 })).rejects.toThrow("privacy_unavailable");
  });
  it("rechecks native admission after await and does not release a queued page after revocation", async () => {
    let refused = false; const f = native(true, () => { if (refused) throw Error("Synthetic post-await refusal"); });
    const pending = f.privacy.learningPage!({ take: 1 }); refused = true;
    await expect(pending).rejects.toThrow("privacy_unavailable"); refused = false;
    await expect(f.privacy.learningPage!({ take: 1 })).rejects.toThrow("privacy_unavailable");
  });
  it("freshly applies native public retraction, republication and erasure while financial columns stay unchanged", async () => {
    const writer = native(false), reader = openVerifiedSqliteStorage(writer.file, identity, { readOnly: true, applicationProfiles: supportedSqliteApplicationProfiles(true) });
    opened.push(reader); const privacy = createEnrolledSqliteRunPrivacy(reader.db), raw = new DatabaseSync(writer.file, { readOnly: true }); opened.push(raw);
    const financial = () => raw.prepare("SELECT id,budget,total_spent,total_to_creators FROM query_runs ORDER BY id").all();
    const before = financial(); expect(await privacy.learningPage!({ take: 32 })).toHaveLength(1);
    await writer.privacy.change("native_public", actor, { visibility: "private", revision: 0, requestId: randomUUID() });
    expect(await privacy.learningPage!({ take: 32 })).toEqual([]);
    await writer.privacy.change("native_public", actor, { visibility: "public", revision: 1, requestId: randomUUID() });
    expect(await privacy.learningPage!({ take: 32 })).toHaveLength(1);
    await writer.privacy.erase("native_public", actor, { revision: 2, requestId: randomUUID() });
    expect(await privacy.learningPage!({ take: 32 })).toEqual([]); expect(financial()).toEqual(before);
  });
  it("rejects schema drift and a closed connection instead of serving previous rows", async () => {
    const f = native(); expect(await f.privacy.learningPage!({ take: 1 })).toHaveLength(1);
    const raw = new DatabaseSync(f.file);
    try { raw.exec("CREATE TRIGGER synthetic_learning_drift AFTER INSERT ON query_runs BEGIN SELECT 1; END"); } finally { raw.close(); }
    await expect(f.privacy.learningPage!({ take: 1 })).rejects.toThrow("privacy_unavailable");
    const closed = native(); closed.connection.close(); await expect(closed.privacy.learningPage!({ take: 1 })).rejects.toThrow("privacy_unavailable");
  });
});
