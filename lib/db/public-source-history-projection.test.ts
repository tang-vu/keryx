import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Citation, QueryRun } from "../types";
import { projectRecordedEvidenceProvenanceList, SYNTHETIC_EVIDENCE_NOTICE } from "../research/evidence-provenance";
import { SEED_EVIDENCE_FINGERPRINTS } from "../research/seed-evidence-fingerprints";
import { PrivacyError } from "../run-privacy/contracts";
import { loadCitedSourceHistory } from "../sources/cited-source-history";
import { readSqlitePublicSourceHistory } from "./public-source-history-projection";
import { readSqlitePublicQuestions } from "./public-question-projection";
import { createEnrolledSqliteRunPrivacy, createSqliteRunPrivacy, isEnrolledSqlitePrivacyContention, RUN_PRIVACY_SQL } from "./run-privacy-sqlite";
import { installSqliteApplicationSchema } from "./sqlite-application-schema";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { STORAGE_MAINNET_PROFILE_DIGEST, type StorageIdentity } from "./storage-identity";
import { installMainnetApplicationSchema } from "./mainnet-application-schema";
import { installNativeUserDomainSchema } from "./native-user-domain-schema";
import { insertStorageIdentity, installStorageFences } from "./storage-identity-sqlite";
import { assertVerifiedSqliteConnection, isVerifiedSqliteConnection, openVerifiedSqliteStorage } from "./storage-identity-connection";
import { SqliteAdapter } from "./sqlite-adapter";
import { supportedSqliteApplicationProfiles } from "./enrolled-sqlite-schema-profile";
import { writeSqliteQueryRun } from "./query-run-record";

const opened: Array<{ close(): void }> = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });
function citation(index = 0, overrides: Partial<Citation> = {}): Citation {
  return { marker: "S" + index, sourceId: "source_" + index, itemId: "item_" + index, sourceName: "Recorded publisher",
    sourceKind: "public-reference", itemTitle: "Document " + index, itemUrl: `https://docs.example/${index}#section`,
    publicDeliveryKind: "excerpt", weight: 1, reward: 0, rationale: "Synthetic fixture only", ...overrides };
}
function run(id = "public", overrides: Partial<QueryRun> = {}): QueryRun {
  return { id, createdAt: "2026-11-04T00:00:00Z", question: "QUESTION_SENTINEL", answer: "ANSWER_SENTINEL",
    budget: 0.03, engine: "synthetic", totalSpent: 0.012345, totalToCreators: 0.000001, subClaims: [],
    decisions: [], citations: [citation()], trace: [{ phase: "discover", message: "TRACE_SENTINEL", ts: 1 }], ...overrides };
}
function fixture(orphan = false) {
  const db = new DatabaseSync(":memory:"); opened.push(db); installSqliteApplicationSchema(db);
  if (orphan) writeSqliteQueryRun(db, run("orphan"), false);
  db.exec(RUN_PRIVACY_SQL);
  const privacy = createSqliteRunPrivacy(db);
  function add(value: QueryRun, visibility = "public", erased = 0) {
    writeSqliteQueryRun(db, value, false);
    db.prepare("UPDATE run_privacy SET visibility=?,erased=? WHERE run_id=?").run(visibility, erased, value.id);
  }
  function replace(id: string, value: unknown) {
    db.prepare("UPDATE query_runs SET data=? WHERE id=?").run(typeof value === "string" ? value : JSON.stringify(value), id);
  }
  return { db, privacy, add, replace };
}

describe("bounded public source history SQLite projection", () => {
  it.each(["\u2003\u00a0\n", "a\ud800b", "Tiếng Việt 🌍", "\u200b", "a\0b"])("preserves exact JavaScript answer presence for %j", async answer => {
    const f = fixture(); f.add(run("public", { answer }));
    expect((await readSqlitePublicSourceHistory(f.db))[0].hasAnswer).toBe(!!answer.trim());
  });
  it("omits heavy and question-derived fields from native SQL output and all original prose from the port result", async () => {
    const f = fixture();
    for (let index = 0; index < 50; index++) f.add(run("row_" + index, { trace: ["TRACE_SENTINEL".repeat(20000)] as unknown as QueryRun["trace"] }));
    let raw = "", selects = 0;
    const observed = { prepare(sql: string) { const statement = f.db.prepare(sql);
      return { all(...args: Parameters<typeof statement.all>) { const rows = statement.all(...args);
        if (sql.startsWith("WITH chosen")) { raw = JSON.stringify(rows); selects++; } return rows; } };
    } } as unknown as DatabaseSync;
    const changes = f.db.prepare("SELECT total_changes() n").get()!.n;
    const rows = await readSqlitePublicSourceHistory(observed);
    expect(rows).toHaveLength(50); expect(selects).toBe(1);
    expect(raw).not.toContain("TRACE_SENTINEL"); expect(raw).not.toContain("QUESTION_SENTINEL");
    expect(raw.length).toBeLessThan(100_000);
    expect(rows.every(row => Object.keys(row).sort().join(",") === "citations,createdAt,hasAnswer,id")).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("ANSWER_SENTINEL");
    expect(f.db.prepare("SELECT total_changes() n").get()!.n).toBe(changes);
  });
  it("filters hidden, erased and absent-policy originals before JSON materialization", async () => {
    const f = fixture(true); f.add(run());
    for (const [id, visibility, erased] of [["private", "private", 0], ["unlisted", "unlisted", 0], ["erased", "public", 1], ["orphan", "public", 0]] as const) {
      if (id !== "orphan") f.add(run(id), visibility);
      f.replace(id, "malformed PRIVATE_SENTINEL");
      if (erased) f.db.prepare("UPDATE run_privacy SET erased=1 WHERE run_id=?").run(id);
    }
    expect((await readSqlitePublicSourceHistory(f.db)).map(row => row.id)).toEqual(["public"]);
  });
  it("preserves actual full-reader cards, public run counts, ordering and citation limits", async () => {
    const f = fixture();
    for (let index = 0; index < 55; index++) f.add(run("row_" + String(index).padStart(2, "0"), {
      citations: index === 54 ? Array.from({ length: 101 }, (_, n) => citation(n < 100 ? 1 : 999)) : [citation(index)],
    }));
    const full = await f.privacy.list({ take: 50 });
    const old = await loadCitedSourceHistory({ runPrivacyActive: false, listRecentQueries: async () => full });
    const forbidden = vi.fn(async () => { throw Error("No full-run fallback"); });
    const current = await loadCitedSourceHistory({ runPrivacyActive: true, runPrivacy: f.privacy, listRecentQueries: forbidden });
    expect(current).toEqual(old); expect(current.runCount).toBe(50); expect(current.entries).toHaveLength(40);
    expect(current.entries.some(entry => entry.url.includes("/999"))).toBe(false);
    expect(forbidden).not.toHaveBeenCalled();
  });
  it.each(["a\ud800b", "Tiếng Việt 🌍", 'quote " and backslash \\', "line\nnext", "a\0b"])("retains canonical citation strings and excludes unused nested prose: %j", async title => {
    const f = fixture();
    const value = run("public", { citations: [citation(1, { itemTitle: title, rationale: "PRIVATE_RATIONALE_SENTINEL",
      webProvenance: { retrievedAt: "2026-11-04T00:00:00Z", extraction: "pdf", truncated: true,
        publisherGroup: "PRIVATE_GROUP_SENTINEL", normalizedBodyHash: "PRIVATE_HASH_SENTINEL" } })] });
    f.add(value);
    const rows = await f.privacy.sourceHistory!();
    for (const marker of ["PRIVATE_RATIONALE_SENTINEL", "PRIVATE_GROUP_SENTINEL", "PRIVATE_HASH_SENTINEL"]) expect(JSON.stringify(rows)).not.toContain(marker);
    expect(await loadCitedSourceHistory({ runPrivacyActive: true, runPrivacy: f.privacy, listRecentQueries: async () => { throw Error("No fallback"); } }))
      .toEqual(await loadCitedSourceHistory({ runPrivacyActive: false, listRecentQueries: async () => [value] }));
  });
  it("retains all provenance inputs before reducing to answer presence and first100 citations", async () => {
    const f = fixture(), seed = SEED_EVIDENCE_FINGERPRINTS[0];
    const demo = citation(2, { itemTitle: seed.itemTitle, itemUrl: seed.itemUrl, contentReceipt: {
      bodyHash: seed.bodyHash, deliveryKind: "full_text", storageMode: "db_plaintext", plaintextBytes: 100 } });
    const sourceFlagged = citation(3), itemFlagged = citation(4);
    f.db.prepare("INSERT INTO sources(id,name,url,tags,fetch_price,evidence_provenance) VALUES(?,?,?,?,?,?)")
      .run(sourceFlagged.sourceId, "Synthetic source", "https://fixture.example/source", "[]", 0, "synthetic-demo");
    f.db.prepare("INSERT INTO source_items(id,source_id,title,link,evidence_provenance) VALUES(?,?,?,?,?)")
      .run(itemFlagged.itemId!, itemFlagged.sourceId, "Synthetic item", "https://fixture.example/item", "synthetic-demo");
    f.add(run("later-citation", { answer: " ", citations: [...Array.from({ length: 100 }, () => citation(1)), demo] }));
    f.add(run("decision", { answer: "", decisions: [demo] as unknown as QueryRun["decisions"], citations: [citation(5)] }));
    f.add(run("evidence", { answer: "", evidence: [demo] as unknown as QueryRun["evidence"], citations: [citation(6)] }));
    f.add(run("source-flag", { answer: "", citations: [sourceFlagged, citation(7)] }));
    f.add(run("item-flag", { answer: "", citations: [itemFlagged, citation(8)] }));
    const flags = new Set([`source:${sourceFlagged.sourceId}`, `item:${itemFlagged.sourceId}:${itemFlagged.itemId}`]);
    const full = await projectRecordedEvidenceProvenanceList(async () => flags, await f.privacy.list({ take: 50 }));
    expect(full.every(value => value.answer.startsWith(SYNTHETIC_EVIDENCE_NOTICE))).toBe(true);
    expect(await loadCitedSourceHistory({ runPrivacyActive: true, runPrivacy: f.privacy, listRecentQueries: async () => { throw Error("No fallback"); } }))
      .toEqual(await loadCitedSourceHistory({ runPrivacyActive: false, listRecentQueries: async () => full }));
  });
  it.each([{ id: "other" }, { createdAt: 1 }, { question: [] }, { answer: {} }, { budget: true }, { engine: null },
    { totalSpent: "0" }, { totalToCreators: null }, { subClaims: {} }, { decisions: null }, { citations: "[]" }, { trace: false }])(
    "refuses malformed mandatory metadata %j", async change => {
      const f = fixture(); f.add(run()); f.replace("public", { ...run(), ...change });
      await expect(readSqlitePublicSourceHistory(f.db)).rejects.toThrow(PrivacyError);
    });
  it.each(["id", "answer", "trace", "evidence"])("refuses duplicate selected JSON keys: %s", async key => {
    const f = fixture(), value = { ...run(), evidence: [] }; f.add(value);
    f.replace("public", JSON.stringify(value).replace(/^\{/u, `{${JSON.stringify(key)}:${JSON.stringify(value[key as keyof typeof value])},`));
    await expect(readSqlitePublicSourceHistory(f.db)).rejects.toThrow("privacy_unavailable");
  });
  it.each(["malformed", "[]", "{}", '{"id":"public","budget":1e999}'])("refuses malformed or missing canonical metadata %s", async value => {
    const f = fixture(); f.add(run()); f.replace("public", value);
    await expect(readSqlitePublicSourceHistory(f.db)).rejects.toThrow("privacy_unavailable");
  });
  it.each(["trailing-comma", "unquoted-key", "comment", "raw-nul-suffix", "blob"])("retains the original strict JSON refusal in both public projections: %s", async kind => {
    const f = fixture(); f.add(run()); const strict = JSON.stringify(run());
    const raw = kind === "trailing-comma" ? strict.replace(/\}$/u, ",}") : kind === "unquoted-key" ? strict.replace('"id":', "id:")
      : kind === "comment" ? "/* fixture */" + strict : kind === "raw-nul-suffix" ? strict + "\0ignored" : Buffer.from(strict);
    f.db.prepare("UPDATE query_runs SET data=? WHERE id='public'").run(raw);
    const stored = f.db.prepare("SELECT data FROM query_runs WHERE id='public'").get()!.data;
    expect(() => JSON.parse(String(stored))).toThrow();
    await expect(readSqlitePublicSourceHistory(f.db)).rejects.toThrow("privacy_unavailable");
    expect(() => readSqlitePublicQuestions(f.db, ["public"])).toThrow("privacy_unavailable");
  });
  it("preserves a legitimate escaped NUL inside canonical question text", () => {
    const f = fixture(); f.add(run("public", { question: "a\0b" }));
    expect(readSqlitePublicQuestions(f.db, ["public"])).toEqual([{ id: "public", question: "a\0b" }]);
  });
  it("refuses physical UTF8 overflow even when discarded duplicate/unknown fields would parse to a small run", async () => {
    const f = fixture(); f.add(run()); f.replace("public", { ...run(), trace: ["界".repeat(1_400_000)] });
    await expect(readSqlitePublicSourceHistory(f.db)).rejects.toThrow("privacy_unavailable");
  });
  it("keeps malformed optional provenance behavior rather than making an unavailable history look empty", async () => {
    const f = fixture(); f.add(run("public", { evidence: "malformed" as unknown as QueryRun["evidence"],
      decisions: [{ evidenceProvenance: "synthetic-demo", sourceId: "demo" }] as unknown as QueryRun["decisions"] }));
    await expect(readSqlitePublicSourceHistory(f.db)).rejects.toThrow("privacy_unavailable");
  });
  it("preserves an actual native refusal object", async () => {
    const refusal = new PrivacyError("privacy_unavailable");
    const denied = { prepare() { throw refusal; } } as unknown as DatabaseSync;
    await expect(readSqlitePublicSourceHistory(denied)).rejects.toBe(refusal);
  });
});

describe("real enrolled readonly source-history port", () => {
  let directory: string, template: string, identity: StorageIdentity, index = 0;
  const wallet = `0x${"a".repeat(40)}`, sessionHash = "a".repeat(64);
  const actor = { wallet, sessionHash, binding: { network: "eip155:5042" as const, origin: "https://synthetic-source-history.example" } };
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), "keryx-source-history-")); template = join(directory, "template.sqlite");
    identity = { ...syntheticStorageIdentity("mainnet-real"), format: "keryx-mainnet-storage-identity-v1",
      network: actor.binding.network, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST };
    const db = new DatabaseSync(template), now = Date.now();
    try {
      db.exec("BEGIN IMMEDIATE"); installMainnetApplicationSchema(db);
      writeSqliteQueryRun(db, run("historical", { asker: wallet }), false); installNativeUserDomainSchema(db);
      for (const id of ["public", "private", "unlisted", "erased"]) writeSqliteQueryRun(db, run(id, { asker: wallet }), false);
      db.prepare("UPDATE run_privacy SET visibility='public' WHERE run_id IN ('public','erased')").run();
      db.prepare("UPDATE run_privacy SET visibility='unlisted' WHERE run_id='unlisted'").run();
      db.prepare("UPDATE run_privacy SET erased=1 WHERE run_id='erased'").run();
      db.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(sessionHash, wallet, now - 2000, now + 600_000);
      insertStorageIdentity(db, identity); installStorageFences(db, identity); db.exec("COMMIT");
    } finally { db.close(); }
  });
  afterAll(() => {
    if (!directory) return;
    const target = resolve(directory), base = resolve(tmpdir()), child = relative(base, target);
    if (!child || isAbsolute(child) || child === ".." || child.startsWith(".." + sep)) throw Error("Fixture cleanup escaped owned temp root");
    rmSync(target, { recursive: true, force: true });
  });
  function native(options: { readOnly?: boolean; runtimeGuard?: () => void } = {}) {
    const file = join(directory, "case-" + ++index + ".sqlite"); copyFileSync(template, file);
    const connection = openVerifiedSqliteStorage(file, identity, { ...options, applicationProfiles: supportedSqliteApplicationProfiles(true) });
    opened.push(connection); return { file, connection, privacy: createEnrolledSqliteRunPrivacy(connection.db) };
  }
  it("retains every fresh native guard and original byte while exposing only public source metadata", async () => {
    let guards = 0; const f = native({ readOnly: true, runtimeGuard: () => { guards++; } }), original = readFileSync(f.file);
    // Compare the complete existing full adapter path, including its source/item
    // provenance lookups. A raw privacy.list omits those four native guard calls.
    const full = SqliteAdapter.assembleConnectionCore(f.connection.db, identity, () => { assertVerifiedSqliteConnection(f.connection.db); });
    Object.defineProperties(full, { runPrivacyActive: { value: true }, runPrivacy: { value: f.privacy } });
    let before = guards; await full.listRecentQueries(50); const fullGuards = guards - before;
    before = guards; const rows = await f.privacy.sourceHistory!(); const slimGuards = guards - before;
    expect(rows.map(row => row.id)).toEqual(["public"]); expect(slimGuards).toBe(fullGuards); expect(slimGuards).toBeGreaterThan(1);
    expect(readFileSync(f.file)).toEqual(original); expect(isVerifiedSqliteConnection(f.connection.db)).toBe(true);
    const raw = new DatabaseSync(f.file, { readOnly: true }); opened.push(raw);
    expect(() => createSqliteRunPrivacy(raw)).toThrow(); expect(() => createEnrolledSqliteRunPrivacy(raw)).toThrow();
  });
  it("freshly retracts and erases a public source run without rewriting financial columns", async () => {
    const writer = native(), reader = openVerifiedSqliteStorage(writer.file, identity, { readOnly: true, applicationProfiles: supportedSqliteApplicationProfiles(true) }); opened.push(reader);
    const privacy = createEnrolledSqliteRunPrivacy(reader.db), raw = new DatabaseSync(writer.file, { readOnly: true }); opened.push(raw);
    const financial = () => raw.prepare("SELECT id,budget,total_spent,total_to_creators FROM query_runs ORDER BY id").all();
    const before = financial(); expect(await privacy.sourceHistory!()).toHaveLength(1);
    await writer.privacy.change("public", actor, { visibility: "private", revision: 0, requestId: randomUUID() }); expect(await privacy.sourceHistory!()).toEqual([]);
    await writer.privacy.change("public", actor, { visibility: "public", revision: 1, requestId: randomUUID() }); expect(await privacy.sourceHistory!()).toHaveLength(1);
    await writer.privacy.erase("public", actor, { revision: 2, requestId: randomUUID() }); expect(await privacy.sourceHistory!()).toEqual([]);
    expect(financial()).toEqual(before);
  });
  it("preserves native contention identity without retirement or a full-reader fallback", async () => {
    const f = native(), blocker = new DatabaseSync(f.file); opened.push(blocker);
    const fallback = vi.fn(async () => { throw Error("No legacy fallback"); });
    blocker.exec("BEGIN EXCLUSIVE");
    try {
      let failure: unknown;
      try { await loadCitedSourceHistory({ runPrivacyActive: true, runPrivacy: f.privacy, listRecentQueries: fallback }); } catch (error) { failure = error; }
      expect(failure).toBeDefined(); expect(isEnrolledSqlitePrivacyContention(failure)).toBe(true);
      expect(isVerifiedSqliteConnection(f.connection.db)).toBe(true); expect(fallback).not.toHaveBeenCalled();
    } finally { blocker.exec("ROLLBACK"); }
    expect(await f.privacy.sourceHistory!()).toHaveLength(1);
  });
  it("keeps guard revocation terminal after the external guard recovers", async () => {
    let refused = false; const f = native({ readOnly: true, runtimeGuard: () => { if (refused) throw Error("Synthetic guard revoked"); } });
    expect(await f.privacy.sourceHistory!()).toHaveLength(1); refused = true;
    await expect(f.privacy.sourceHistory!()).rejects.toThrow("privacy_unavailable"); refused = false;
    await expect(f.privacy.sourceHistory!()).rejects.toThrow("privacy_unavailable");
  });
});
