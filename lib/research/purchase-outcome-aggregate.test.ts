import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { installSqliteApplicationSchema } from "../db/sqlite-application-schema";
import { createSqliteRunPrivacy, RUN_PRIVACY_SQL } from "../db/run-privacy-sqlite";
import { createSqlitePublicUsage } from "../db/public-usage-sqlite";
import { writeSqliteQueryRun } from "../db/query-run-record";
import { createTrustedUsageContext, newRunUsage } from "./usage-provenance";
import type { QueryRun } from "../types";
import type { PublicUsageStore, UsageWindow } from "../usage/contracts";
import { withDecisionBasis } from "./decision-basis";
import { cohortPurchaseScore, PURCHASE_AGGREGATE_RULES, validatePurchaseAggregate,
  type PurchaseAggregateCohort } from "./purchase-outcome-aggregate";
import { buildPurchaseOutcomeAggregate, readPublicPurchaseAggregate, purchaseAggregateResponse, purchaseAggregateWindow } from "./purchase-outcome-aggregate-server";
const boundary=vi.hoisted(()=>({db:vi.fn()}));
vi.mock("../db",()=>({getDb:boundary.db}));
afterEach(()=>vi.unstubAllEnvs());

const network = "eip155:5042002" as const;
const window: UsageWindow = { network, since: "2026-10-01T00:00:00.000Z", until: "2026-10-11T00:00:00.000Z", period: "custom" };
type Purchase = { id: string; expectedValue: number; cited: boolean; settlement?: "settled" | "simulated" | "pending" };

/** Synthetic offline fixture: recorded-shape rows only, no real source, wallet or settlement. */
function run(id: string, day: number, purchases: Purchase[], extra: Partial<QueryRun> = {}): QueryRun {
  const identity = (row: Purchase) => ({ sourceId: `source-${row.id}`, itemId: `item-${row.id}`, contentVersion: "v1" });
  const decisions = purchases.map(row => ({ ...identity(row), assetId: `item:item-${row.id}`, sourceName: row.id, action: "BUY" as const,
    expectedValue: row.expectedValue, price: 0.002, confidence: 0.7, rationale: "PRIVATE-REASON", targets: [0] }));
  return { id, question: "PRIVATE-QUESTION", budget: 0.05, engine: "heuristic", subClaims: ["claim"], decisions,
    citations: purchases.filter(row => row.cited).map((row, index) => ({ ...identity(row), marker: `S${index + 1}`, sourceName: row.id,
      weight: 1 / purchases.filter(item => item.cited).length, reward: 0.001, rationale: "PRIVATE-WEIGHT" })),
    answer: "Synthetic answer", totalSpent: 0, totalToCreators: 0,
    trace: purchases.map((row, index) => ({ phase: "fetch" as const, message: "PRIVATE-TRACE", ts: index,
      detail: { ...identity(row), id: `${id}-pay-${index}`, kind: "fetch", queryId: id, network, amountUsdc: 0.002,
        settled: row.settlement === undefined || row.settlement === "settled", settlementStatus: row.settlement ?? "settled",
        txHash: "0xabc", payer: "PRIVATE-PAYER", payee: "PRIVATE-PAYEE" } })),
    createdAt: `2026-10-0${day}T12:00:00.000Z`, asker: "PRIVATE-WALLET", ...extra };
}
function store(byCohort: Partial<Record<PurchaseAggregateCohort, QueryRun[]>>, windowRuns: Partial<Record<PurchaseAggregateCohort, number>> = {}) {
  const history = vi.fn(async (_window: UsageWindow, cohort: string, limit: number) => {
    expect(limit).toBe(100);
    return byCohort[cohort as PurchaseAggregateCohort] ?? [];
  });
  const summary = vi.fn(async () => ({ columns: (["outside", "team", "scripted", "unknown"] as const).map(cohort =>
    ({ cohort, researchRuns: windowRuns[cohort] ?? byCohort[cohort]?.length ?? 0 })) }));
  return { history, summary } as unknown as PublicUsageStore & { history: typeof history; summary: typeof summary };
}
const column = (report: ReturnType<typeof validatePurchaseAggregate>, cohort: PurchaseAggregateCohort) =>
  report.columns.find(row => row.cohort === cohort)!;

describe("pooled public purchase outcomes", () => {
  it("never falls back to financial totals or legacy history when active population is absent or malformed",async()=>{
    const summary=vi.fn(),history=vi.fn();
    for(const publishedHistory of [undefined,vi.fn(async()=>undefined)]) {
      await expect(buildPurchaseOutcomeAggregate(window,{summary,history,publishedHistory} as unknown as PublicUsageStore,true)).rejects.toThrow();
      expect(summary).not.toHaveBeenCalled();expect(history).not.toHaveBeenCalled();
    }
  });
  it("bypasses warmed legacy and active caches after publication revocation and refuses active missing/schema ports",async()=>{
    const connection=new DatabaseSync(":memory:");installSqliteApplicationSchema(connection);connection.exec(RUN_PRIVACY_SQL);
    try {
      const usage=newRunUsage({usageContext:createTrustedUsageContext(network,{actor:"unknown",funding:"unknown",scripted:true})},network,[]);
      const saved=run("public-revocable",3,[{id:"exact",expectedValue:0.6,cited:false}],{usage,asker:undefined});
      writeSqliteQueryRun(connection,saved,true);connection.prepare("UPDATE run_privacy SET visibility='public' WHERE run_id=?").run(saved.id);
      const privacy=createSqliteRunPrivacy(connection),publicUsage=createSqlitePublicUsage(connection,()=>privacy),params=new URLSearchParams("network=eip155:5042002&since=2026-10-01"),now=new Date(window.until);
      boundary.db.mockResolvedValue({runPrivacyActive:false,publicUsage:createSqlitePublicUsage(connection)});
      const legacy=await readPublicPurchaseAggregate(params,now);expect(column(legacy,"scripted").sampledRuns).toBe(1);
      boundary.db.mockResolvedValue({runPrivacyActive:true,runPrivacy:privacy,publicUsage});
      expect(column(await readPublicPurchaseAggregate(params,now),"scripted").sampledRuns).toBe(1);
      connection.prepare("UPDATE run_privacy SET visibility='unlisted',revision=1 WHERE run_id=?").run(saved.id);
      const next=await readPublicPurchaseAggregate(params,new Date(now.getTime()+1));expect(column(next,"scripted")).toMatchObject({windowRuns:0,sampledRuns:0});
      const financial=await publicUsage.summary(window);expect(financial.columns[2].researchRuns).toBe(1);
      boundary.db.mockResolvedValue({runPrivacyActive:true,publicUsage});
      await expect(readPublicPurchaseAggregate(params,now)).rejects.toThrow("privacy_unavailable");
      const refused=await purchaseAggregateResponse(new Request(`https://synthetic.example/api/purchase-outcomes?${params}`));
      expect(refused.status).toBe(503);expect(await refused.json()).toEqual({error:"purchase_outcomes_unavailable",complete:false,figures:null});
      boundary.db.mockResolvedValue({runPrivacyActive:true,runPrivacy:privacy,publicUsage});connection.exec("ALTER TABLE run_privacy ADD COLUMN unknown TEXT");
      await expect(readPublicPurchaseAggregate(params,now)).rejects.toThrow("privacy_unavailable");
      // OFF remains an explicit admitted lane even with the ambient flag ON.
      vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED","true");boundary.db.mockResolvedValue({runPrivacyActive:false,publicUsage:createSqlitePublicUsage(connection)});
      expect(await readPublicPurchaseAggregate(params,now)).toEqual(legacy);
    } finally {connection.close();}
  });
  const outside = [run("out-1", 2, [{ id: "a", expectedValue: 0.9, cited: true }, { id: "b", expectedValue: 0.3, cited: false }]),
    run("out-2", 4, [{ id: "a", expectedValue: 0.7, cited: true }])];
  const withBasis = run("team-1", 5, [{ id: "c", expectedValue: 0.5, cited: false }]);
  withBasis.decisions = withDecisionBasis(withBasis.decisions, { fetchBudgetUsdc: 0.035, ruleFor: () => "selected" });
  const team = [withBasis, run("team-2", 6, [{ id: "d", expectedValue: 0.8, cited: true, settlement: "simulated" }]),
    run("team-3", 7, [], { answer: "" })];

  it("states sample, period and counting rule and keeps cohorts separate", async () => {
    const fake = store({ outside, team }, { outside: 140 });
    const report = await buildPurchaseOutcomeAggregate(window, fake);
    expect(report).toMatchObject({ schemaVersion: "keryx-purchase-outcome-aggregate-v1", network, period: "custom",
      since: window.since, until: window.until, basis: "newest-recorded-runs-per-cohort", sampleLimitPerCohort: 100,
      settlementEvidence: "recorded-only-not-revalidated", coverage: "partial-retained-trace",
      missedValue: null, costPerSupportedClaim: null, byQuestionType: null, rules: PURCHASE_AGGREGATE_RULES });
    expect(report.columns.map(row => row.cohort)).toEqual(["outside", "team", "scripted", "unknown"]);
    expect(column(report, "outside")).toMatchObject({ windowRuns: 140, sampledRuns: 2, sampleComplete: false, unscorableRuns: 0,
      sampleFirstRunAt: "2026-10-02T12:00:00.000Z", sampleLastRunAt: "2026-10-04T12:00:00.000Z",
      recordedDecisions: 3, decisionsWithBasis: 0, recordedBuyDecisions: 3, unscoredBuyDecisions: 0,
      // The same article bought in two runs is two purchases; each run paid for its own read.
      scoredPurchases: 3, citedPurchases: 2, hitRate: 2 / 3, settledAccessMicros: "6000", uncitedAccessMicros: "2000" });
    expect(column(report, "outside").calibration.map(band => [band.samples, band.cited])).toEqual([[0, 0], [1, 0], [0, 0], [1, 1], [1, 1]]);
    expect(column(report, "outside").calibrationGap).toBeCloseTo((0.3 + 0.3 + 0.1) / 3);
    // Simulated access is not a settled purchase, and an unanswered run is unscorable, not free.
    expect(column(report, "team")).toMatchObject({ windowRuns: 3, sampledRuns: 3, sampleComplete: true, unscorableRuns: 1,
      recordedDecisions: 2, decisionsWithBasis: 1, recordedBuyDecisions: 2, unscoredBuyDecisions: 1,
      scoredPurchases: 1, citedPurchases: 0, hitRate: 0, settledAccessMicros: "2000", uncitedAccessMicros: "2000" });
    for (const empty of ["scripted", "unknown"] as const)
      expect(column(report, empty)).toMatchObject({ windowRuns: 0, sampledRuns: 0, sampleComplete: true, sampleFirstRunAt: null,
        scoredPurchases: 0, hitRate: null, calibrationGap: null, settledAccessMicros: "0" });
    expect(fake.history.mock.calls.map(call => call[1])).toEqual(["outside", "team", "scripted", "unknown"]);
    expect(cohortPurchaseScore(report, "outside")).toMatchObject({ scoredPurchases: 3, citedPurchases: 2 });
    const json = JSON.stringify(report);
    expect(json).not.toContain("PRIVATE"); expect(json).not.toMatch(/source-a|item-a|0xabc|asker|payer|payee/);
    expect(validatePurchaseAggregate(JSON.parse(json))).toEqual(report);
  });

  it("refuses ambiguous samples and edited figures", async () => {
    await expect(buildPurchaseOutcomeAggregate(window, store({ outside, team: [outside[0]] }))).rejects.toThrow("Ambiguous sampled run");
    await expect(buildPurchaseOutcomeAggregate(window, store({ outside: [run("late", 2, [], { createdAt: "2026-10-11T00:00:00.000Z" })] })))
      .rejects.toThrow("Ambiguous sampled run");
    await expect(buildPurchaseOutcomeAggregate(window, store({ unknown: Array.from({ length: 101 }, (_, index) => run(`r-${index}`, 3, [])) })))
      .rejects.toThrow("Invalid cohort sample");
    const report = await buildPurchaseOutcomeAggregate(window, store({ outside, team }));
    const edit = (change: (row: (typeof report.columns)[number]) => void) => {
      const copy = structuredClone(report); change(copy.columns[0]); return copy;
    };
    for (const bad of [edit(row => { row.hitRate = 1; }), edit(row => { row.uncitedAccessMicros = "0"; }),
      edit(row => { row.cohort = "team"; }), edit(row => { row.sampleComplete = false; }), edit(row => { row.decisionsWithBasis = 9; }),
      edit(row => { row.calibrationGap = 0; }), edit(row => { row.unscoredBuyDecisions = 5; }),
      { ...report, rules: { ...report.rules, hitRate: "cited purchases are good purchases" } }, { ...report, missedValue: 0 },
      { ...report, until: report.since }, { ...report, extra: true }])
      expect(() => validatePurchaseAggregate(bad)).toThrow();
    // A run saved between the count and the sample can only raise the period count, never hide a sampled run.
    expect(column(await buildPurchaseOutcomeAggregate(window, store({ outside }, { outside: 1 })), "outside"))
      .toMatchObject({ windowRuns: 2, sampledRuns: 2, sampleComplete: true });
  });

  it("serves validated JSON, refuses unknown filters and withholds figures on failure", async () => {
    const report = await buildPurchaseOutcomeAggregate(window, store({ outside, team }));
    const ok = await purchaseAggregateResponse(new Request("https://keryx.invalid/api/purchase-outcomes?period=7d"), async () => report);
    expect(ok.status).toBe(200); expect(ok.headers.get("Cache-Control")).toBe("no-store"); expect(await ok.json()).toEqual(report);
    const read = vi.fn(async () => report);
    for (const query of ["cohort=outside", "period=1y", "period=7d&period=30d", "since=2026-13-01", "network=eip155:1", "download=1"]) {
      const refused = await purchaseAggregateResponse(new Request(`https://keryx.invalid/api/purchase-outcomes?${query}`), read);
      expect(refused.status).toBe(400); expect(await refused.json()).toEqual({ error: "invalid_purchase_outcome_filter" });
    }
    expect(read).not.toHaveBeenCalled();
    for (const failing of [async () => { throw new Error("PRIVATE storage detail"); }, async () => ({ ...report, hitRate: 1 })]) {
      const unavailable = await purchaseAggregateResponse(new Request("https://keryx.invalid/api/purchase-outcomes"), failing);
      expect(unavailable.status).toBe(503);
      expect(await unavailable.json()).toEqual({ error: "purchase_outcomes_unavailable", complete: false, figures: null });
    }
    expect(purchaseAggregateWindow(new URLSearchParams("period=30d&network=eip155:5042002"), new Date("2026-10-11T00:00:00.000Z")))
      .toEqual({ network, period: "30d", since: "2026-09-11T00:00:00.000Z", until: "2026-10-11T00:00:00.000Z" });
  });

  it("uses actual isolated SQLite classification/history without treating trace money as ledger volume", async () => {
    const db = new DatabaseSync(":memory:"); installSqliteApplicationSchema(db); db.exec(RUN_PRIVACY_SQL);
    const privacy=createSqliteRunPrivacy(db),publicUsage=createSqlitePublicUsage(db,()=>privacy);
    try {
      const usage = newRunUsage({ usageContext: createTrustedUsageContext(network,
        { actor: "unknown", funding: "unknown", scripted: true }) }, network, []);
      const scripted = run("scripted-real-adapter", 3, [{ id: "exact", expectedValue: 0.6, cited: false }], { usage, asker: undefined });
      writeSqliteQueryRun(db,scripted,true);
      writeSqliteQueryRun(db,{ ...scripted, id: "scripted-empty", answer: "", decisions: [], citations: [], trace: [] },true);
      db.exec("UPDATE run_privacy SET visibility='public'");
      for(const [id,visibility,erased] of [["hidden","private",0],["link","unlisted",0],["erased","public",1]] as const) {
        writeSqliteQueryRun(db,{...scripted,id},true);db.prepare("UPDATE run_privacy SET visibility=?,erased=? WHERE run_id=?").run(visibility,erased,id);
      }
      const rows=JSON.stringify(db.prepare("SELECT * FROM query_runs ORDER BY id").all()),summary=await publicUsage.summary(window);
      const report = await buildPurchaseOutcomeAggregate(window, publicUsage,true);
      expect(column(report, "scripted")).toMatchObject({ sampledRuns: 2, windowRuns: 2, unscorableRuns: 1,
        scoredPurchases: 1, citedPurchases: 0, settledAccessMicros: "2000" });
      expect(column(report, "outside")).toMatchObject({ sampledRuns: 0, scoredPurchases: 0, hitRate: null });
      // The score explicitly observes retained trace bookkeeping. A separate financial
      // ledger has no settlement rows and must never acquire volume from these fixtures.
      expect(summary.columns[2].researchRuns).toBe(5);
      expect((await publicUsage.summary(window))).toEqual(summary);
      expect(summary.columns.every(row => row.settledMicros === "0")).toBe(true);
      expect(JSON.stringify(db.prepare("SELECT * FROM query_runs ORDER BY id").all())).toBe(rows);
      expect(JSON.stringify(report)).not.toContain("PRIVATE");
    } finally { db.close(); }
  });
});
