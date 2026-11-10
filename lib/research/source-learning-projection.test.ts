import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { QueryRun, Source } from "../types";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { createSqliteRunPrivacy, RUN_PRIVACY_SQL } from "../db/run-privacy-sqlite";
import { installSqliteApplicationSchema } from "../db/sqlite-application-schema";
import { writeSqliteQueryRun } from "../db/query-run-record";
import { createTrustedUsageContext, newRunUsage } from "./usage-provenance";
import { aggregateSourceLearning, readSourceLearning } from "./source-learning-server";
import { sourceLearningResponse } from "./source-learning-http";

const opened: DatabaseSync[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); vi.unstubAllEnvs(); });
const network = "eip155:5042", actor = `0x${"ab".repeat(20)}`;
const source: Source = { id: "source_a", name: "Synthetic source", url: "https://synthetic-learning.invalid", description: "Synthetic",
  walletAddress: `0x${"cd".repeat(20)}`, fetchPrice: 0.001, tags: ["x402"], authors: [], createdAt: "2026-01-01T00:00:00.000Z" };
function run(index: number, overrides: Partial<QueryRun> = {}): QueryRun {
  return { id: `public_${String(index).padStart(3, "0")}`, createdAt: new Date(Date.UTC(2026, 0, 1 + index)).toISOString(),
    question: "QUESTION_SENTINEL", answer: "ANSWER_SENTINEL", engine: "synthetic", budget: 0, totalSpent: 0, totalToCreators: 0,
    decisions: [{ sourceId: source.id, sourceName: source.name, action: "BUY", price: 0.001, expectedValue: 0.8, confidence: 0.8, targets: [0], rationale: "Synthetic" }],
    subClaims: [], citations: [], trace: [{ phase: "fetch", message: "TRACE_SENTINEL", ts: 0 }], paymentMode: "real", asker: actor,
    provenance: { version: 1, surface: "web", ownershipMethod: "session" },
    usage: newRunUsage({ usageContext: createTrustedUsageContext(network, { actor: "outside", funding: "independent", scripted: false,
      actorEvidenceSha256: "a".repeat(64), fundingEvidenceSha256: "b".repeat(64) }) }, network, []),
    sourceLearning: { version: 1, network, sources: [{ sourceId: source.id, topics: ["x402"], eligibility: "eligible",
      read: true, cached: false, bought: true, cited: true, accessMicros: "1000", contribution: 0.8 }] }, ...overrides };
}
function fixture() {
  const db = new DatabaseSync(":memory:"); opened.push(db); installSqliteApplicationSchema(db); db.exec(RUN_PRIVACY_SQL);
  const privacy = createSqliteRunPrivacy(db);
  const add = (value: QueryRun, visibility = "public") => {
    writeSqliteQueryRun(db, value, false); db.prepare("UPDATE run_privacy SET visibility=? WHERE run_id=?").run(visibility, value.id);
  };
  const store = { runPrivacyActive: true, runPrivacy: privacy, getSource: vi.fn(async () => source as Source | null),
    readEvidenceProvenance: vi.fn(async () => new Set<string>()), iterateRecentQueries: SqliteAdapter.prototype.iterateRecentQueries };
  return { db, privacy, add, store, legacy: { ...store, runPrivacy: { ...privacy, learningPage: undefined } } };
}

it("matches the complete scalar report for eligibility, historical and protected observations while omitting original text", async () => {
  const f = fixture();
  for (let index = 0; index < 40; index++) f.add(run(index));
  f.add(run(41, { sourceLearning: undefined }));
  const owner = run(42); owner.sourceLearning!.sources[0].eligibility = "owner"; f.add(owner);
  const offline = run(43, { paymentMode: "offline" }); offline.sourceLearning!.sources[0].eligibility = "offline"; f.add(offline);
  f.add(run(44, { id: "prv_synthetic" }));
  f.add(run(45, { originalFulfillment: { original: "ORIGINAL_SENTINEL" } as unknown as QueryRun["originalFulfillment"] }));
  f.add(run(46, { originalFulfillment: "\u0000ORIGINAL_SENTINEL" as unknown as QueryRun["originalFulfillment"] }));
  const before = f.db.prepare("SELECT * FROM query_runs ORDER BY id").all();
  const baseline = await readSourceLearning(f.legacy, source.id, network), report = await readSourceLearning(f.store, source.id, network);
  expect(report).toEqual(baseline); expect(report).toMatchObject({ historicalUnclassifiedRuns: 1, excludedObservations: 2,
    records: [{ offered: 40, bought: 40, cited: 40, averagePriceMicros: { numerator: "40000", denominator: 40 } }] });
  for (const secret of ["QUESTION_SENTINEL", "ANSWER_SENTINEL", "TRACE_SENTINEL", "ORIGINAL_SENTINEL", actor]) expect(JSON.stringify(report)).not.toContain(secret);
  expect(f.db.prepare("SELECT * FROM query_runs ORDER BY id").all()).toEqual(before);
});

it("scans exactly the first300 freshly public originals in ten pages without touching the scalar iterator or refetch", async () => {
  const f = fixture();
  for (let index = 0; index < 320; index++) f.add(run(500 + index), index % 2 ? "private" : "unlisted");
  for (let index = 0; index < 310; index++) {
    const value = run(index);
    if (index >= 10) value.sourceLearning = { version: 1, network, sources: [] };
    f.add(value);
  }
  const baseline = await readSourceLearning(f.legacy, source.id, network);
  const learningPage = vi.fn(f.privacy.learningPage!), read = vi.fn(f.privacy.read), scan = vi.fn(f.store.iterateRecentQueries);
  const report = await readSourceLearning({ ...f.store, runPrivacy: { ...f.privacy, learningPage, read }, iterateRecentQueries: scan }, source.id, network);
  expect(report).toEqual(baseline); expect(report).toMatchObject({ records: [], excludedObservations: 0, historicalUnclassifiedRuns: 0 });
  expect(learningPage).toHaveBeenCalledTimes(10); expect(learningPage.mock.calls.at(-1)![0].take).toBe(12);
  expect(read).not.toHaveBeenCalled(); expect(scan).not.toHaveBeenCalled();
});

it("uses a fresh storage page after publication is withdrawn between pages", async () => {
  const f = fixture(); for (let index = 0; index < 40; index++) f.add(run(index));
  let calls = 0;
  const learningPage: NonNullable<typeof f.privacy.learningPage> = async query => {
    if (++calls === 2) f.db.prepare("UPDATE run_privacy SET visibility='private',revision=revision+1 WHERE run_id='public_001'").run();
    return f.privacy.learningPage!(query);
  };
  const report = await readSourceLearning({ ...f.store, runPrivacy: { ...f.privacy, learningPage } }, source.id, network);
  expect(report!.records[0].offered).toBe(39); expect(report).toEqual(await readSourceLearning(f.legacy, source.id, network));
});

it.each(["withdrawn", "erased"])("services queued privacy work before another page reads a %s observation", async change => {
  const f = fixture(); for (let index = 0; index < 40; index++) f.add(run(index));
  let calls = 0, serviced = false, queued: NodeJS.Immediate | undefined;
  const learningPage: NonNullable<typeof f.privacy.learningPage> = async query => {
    const page = await f.privacy.learningPage!(query);
    if (++calls === 1) queued = setImmediate(() => {
      serviced = true;
      f.db.prepare(change === "erased"
        ? "UPDATE run_privacy SET erased=1,revision=revision+1 WHERE run_id='public_001'"
        : "UPDATE run_privacy SET visibility='private',revision=revision+1 WHERE run_id='public_001'").run();
    });
    return page;
  };
  try {
    const report = await readSourceLearning({ ...f.store, runPrivacy: { ...f.privacy, learningPage } }, source.id, network);
    expect({ serviced, offered: report!.records[0].offered, calls }).toEqual({ serviced: true, offered: 39, calls: 2 });
    expect(report).toEqual(await readSourceLearning(f.legacy, source.id, network));
  } finally { if (queued) clearImmediate(queued); }
});

it("services queued work between every full page and stops at300 without an extra wait", async () => {
  const f = fixture(), values = Array.from({ length: 300 }, (_, index) => run(index)); values.forEach(value => f.add(value));
  const events: string[] = [], queued: NodeJS.Immediate[] = []; let calls = 0;
  const learningPage: NonNullable<typeof f.privacy.learningPage> = async query => {
    const page = await f.privacy.learningPage!(query), current = ++calls; events.push(`page${current}`);
    queued.push(setImmediate(() => events.push(`other${current}`)));
    return page;
  };
  try {
    const report = await readSourceLearning({ ...f.store, runPrivacy: { ...f.privacy, learningPage } }, source.id, network);
    expect(report).toEqual(aggregateSourceLearning(source.id, network, values));
    expect(events).toEqual(Array.from({ length: 10 }, (_, index) => index === 9
      ? ["page10"] : [`page${index + 1}`, `other${index + 1}`]).flat());
    expect(calls).toBe(10);
  } finally { queued.forEach(clearImmediate); }
});

it.each([0, 1])("returns a terminal page of %i rows without an unnecessary event-loop wait", async count => {
  const f = fixture(); if (count) f.add(run(0)); let serviced = false, queued: NodeJS.Immediate | undefined;
  const learningPage: NonNullable<typeof f.privacy.learningPage> = async query => {
    const page = await f.privacy.learningPage!(query); queued = setImmediate(() => { serviced = true; }); return page;
  };
  try {
    const report = await readSourceLearning({ ...f.store, runPrivacy: { ...f.privacy, learningPage } }, source.id, network);
    expect(report).not.toBeNull(); expect(serviced).toBe(false);
  } finally { if (queued) clearImmediate(queued); }
});

it("refuses a queued close before a later selected page without fallback or private error detail", async () => {
  const f = fixture(); for (let index = 0; index < 40; index++) f.add(run(index));
  let calls = 0, queued: NodeJS.Immediate | undefined;
  const scan = vi.fn(f.store.iterateRecentQueries);
  const learningPage: NonNullable<typeof f.privacy.learningPage> = async query => {
    calls++;
    const page = await f.privacy.learningPage!(query);
    if (calls === 1) queued = setImmediate(() => { opened.splice(opened.indexOf(f.db), 1); f.db.close(); });
    return page;
  };
  try {
    const response = await sourceLearningResponse(new Request("https://synthetic-learning.invalid"), source.id,
      () => readSourceLearning({ ...f.store, runPrivacy: { ...f.privacy, learningPage }, iterateRecentQueries: scan }, source.id, network));
    expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toMatch(/database|sqlite|closed/i);
    expect(calls).toBe(2); expect(scan).not.toHaveBeenCalled();
  } finally { if (queued) clearImmediate(queued); }
});

it("does not fall back or invent an empty report when the selected metadata capability fails", async () => {
  const f = fixture(); f.add(run(0)); const scan = vi.fn(f.store.iterateRecentQueries);
  const learningPage = vi.fn(async () => { throw Error("PRIVATE native schema failure"); });
  const read = () => readSourceLearning({ ...f.store, runPrivacy: { ...f.privacy, learningPage }, iterateRecentQueries: scan }, source.id, network);
  const response = await sourceLearningResponse(new Request("https://synthetic-learning.invalid"), source.id, read);
  expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).not.toContain("PRIVATE"); expect(scan).not.toHaveBeenCalled(); expect(learningPage).toHaveBeenCalledTimes(1);
});

it("refuses oversized or nonprogressing storage pages rather than exceeding its work budget", async () => {
  const f = fixture();
  for (const rows of [Array.from({ length: 33 }, () => run(0)), Array.from({ length: 32 }, () => run(0))]) {
    const learningPage = vi.fn(async () => rows), scan = vi.fn(f.store.iterateRecentQueries);
    await expect(readSourceLearning({ ...f.store, runPrivacy: { ...f.privacy, learningPage }, iterateRecentQueries: scan }, source.id, network)).rejects.toThrow("privacy_unavailable");
    expect(learningPage.mock.calls.length).toBe(rows.length === 33 ? 1 : 2); expect(scan).not.toHaveBeenCalled();
  }
});

it("stops at a partial storage page without polling for newly published older observations", async () => {
  const f = fixture(), learningPage = vi.fn(async () => [run(0)]), scan = vi.fn(f.store.iterateRecentQueries);
  const report = await readSourceLearning({ ...f.store, runPrivacy: { ...f.privacy, learningPage }, iterateRecentQueries: scan }, source.id, network);
  expect(report!.records[0].offered).toBe(1); expect(learningPage).toHaveBeenCalledTimes(1); expect(scan).not.toHaveBeenCalled();
});

it("keeps explicit privacy-OFF streaming and source-not-found behavior without invoking the new capability", async () => {
  const f = fixture(), learningPage = vi.fn(async () => { throw Error("Must not run"); });
  vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED", "true");
  const scan = vi.fn(async function* () { yield run(0); });
  const report = await readSourceLearning({ ...f.store, runPrivacyActive: false, runPrivacy: { ...f.privacy, learningPage }, iterateRecentQueries: scan }, source.id, network);
  expect(report!.records[0].offered).toBe(1); expect(scan).toHaveBeenCalledTimes(1); expect(learningPage).not.toHaveBeenCalled();
  f.store.getSource.mockResolvedValue(null);
  expect(await readSourceLearning({ ...f.store, runPrivacy: { ...f.privacy, learningPage } }, source.id, network)).toBeNull();
  expect(learningPage).not.toHaveBeenCalled();
});
