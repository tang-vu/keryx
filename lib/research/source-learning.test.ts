import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { SupabaseAdapter } from "../db/supabase-adapter";
import { installSqliteApplicationSchema } from "../db/sqlite-application-schema";
import { createSqliteRunPrivacy, RUN_PRIVACY_SQL } from "../db/run-privacy-sqlite";
import { createSupabaseRunPrivacy } from "../db/run-privacy-supabase";
import { writeSqliteQueryRun } from "../db/query-run-record";
import { publicQueryRun } from "./public-query-run";
import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { captureSourceLearning, sourceLearningTopics } from "./source-learning-observations";
import { aggregateSourceLearning, readSourceLearning } from "./source-learning-server";
import { sourceLearningResponse } from "./source-learning-http";
import { validateSourceLearningReport } from "./source-learning-contract";
import { registerSourceLearning } from "./source-learning-mcp";
import { SourceLearningPanel } from "../../components/keryx/source-learning-panel";
import { newRunUsage, createTrustedUsageContext } from "./usage-provenance";
import type { QueryRun, Source, PaymentRecord } from "../types";
import type { SourceFetchTerms } from "../registry/source-fetch-payto";

const network = "eip155:5042", actor = `0x${"ab".repeat(20)}`, owner = `0x${"cd".repeat(20)}`, author = `0x${"ef".repeat(20)}`;
const source: Source = { id: "source-a", name: "Source A", url: "https://source.example", description: "Example", walletAddress: owner,
  fetchPrice: 0.001, tags: ["x402", "security"], authors: [{ name: "Author", walletAddress: author, splitWeight: 1 }], createdAt: "2026-10-01T00:00:00.000Z" };
const terms: SourceFetchTerms = { payTo: owner, creator: owner, active: true, stale: false, authority: "onchain", listPriceUsdc: source.fetchPrice };
afterEach(()=>vi.unstubAllEnvs());
function fixture(index = 0, cited = true, wallet = actor): { run: QueryRun; payments: PaymentRecord[] } {
  const at = new Date(Date.UTC(2026, 9, 1 + index)).toISOString(), id = `run-${index}`;
  const usage = newRunUsage({ usageContext: createTrustedUsageContext(network, { actor: "outside", funding: "independent", scripted: false,
    actorEvidenceSha256: "a".repeat(64), fundingEvidenceSha256: "b".repeat(64) }) }, network, []);
  const run = { id, createdAt: at, question: "x402 secret-unpublished-123 https://private.example/token", usage,
    provenance: { version: 1, surface: "web", ownershipMethod: "session" }, asker: wallet, paymentMode: "real",
    decisions: [{ sourceId: source.id, sourceName: source.name, assetId: "asset-a", itemId: "item-a", contentVersion: "v1",
      action: "BUY", expectedValue: 0.5, price: 0.001, confidence: 0.8, targets: [0], rationale: "Preview" }],
    citations: cited ? [{ sourceId: source.id, sourceName: source.name, itemId: "item-a", contentVersion: "v1", weight: 0.8 }] : [], answer: "Retained answer" } as QueryRun;
  const payments = [{ id: `payment-${index}`, queryId: id, network, sourceId: source.id, sourceName: source.name, itemId: "item-a", contentVersion: "v1",
    kind: "fetch", amountUsdc: 0.001, settled: true, settlementStatus: "settled", txHash: `transaction-${index}`, payee: owner, payer: actor }] as PaymentRecord[];
  run.sourceLearning = captureSourceLearning({ run, sources: [source], terms: new Map([[source.id, terms]]), payments, readSourceIds: new Set([source.id]), readAssetIds: new Set(["asset-a"]) });
  return { run, payments };
}
describe("write-time bounded source records", () => {
  it.each(["sqlite","supabase"] as const)("requires current public publication before learning counts with >300 hidden rows on %s",async adapter=>{
    const connection=new DatabaseSync(":memory:");installSqliteApplicationSchema(connection);connection.exec(RUN_PRIVACY_SQL);
    try {
      const raw=createSqliteRunPrivacy(connection),save=(run:QueryRun,visibility="private",erased=0)=>{
        writeSqliteQueryRun(connection,Object.assign({budget:0,engine:"fixture",totalSpent:0,totalToCreators:0,subClaims:[],trace:[]},run),true);
        connection.prepare("UPDATE run_privacy SET visibility=?,erased=? WHERE run_id=?").run(visibility,erased,run.id);
      };
      for(let i=0;i<320;i++)save({...fixture(0).run,id:`hidden-${i}`,createdAt:"2026-10-10T00:00:00.000Z",sourceLearning:undefined},i%2?"unlisted":"private");
      save({...fixture(0).run,id:"erased",createdAt:"2026-10-10T00:00:00.000Z"},"public",1);
      const published=[fixture(0).run,fixture(1).run];published.forEach(run=>save(run,"public"));
      save({...fixture(3).run,sourceLearning:undefined},"public");
      const original=JSON.stringify(connection.prepare("SELECT * FROM query_runs ORDER BY id").all());
      const from=vi.fn(),rpc=vi.fn((_name:string,args:Record<string,unknown>)=>({abortSignal:async()=>{
        const result=args.p_action==="list"?await raw.list(args.p_input as Parameters<typeof raw.list>[0]).then(async runs=>Promise.all(runs.map(async run=>(await raw.read(run.id)).item)))
          :await raw.read(String(args.p_id));
        return {data:{version:1,action:args.p_action,id:args.p_id,result},error:null};
      }}));
      const privacy=adapter==="sqlite"?raw:createSupabaseRunPrivacy({rpc,from} as unknown as SupabaseClient);
      const store={runPrivacyActive:true,runPrivacy:privacy,getSource:vi.fn(async()=>source),readEvidenceProvenance:vi.fn(async()=>new Set<string>()),
        iterateRecentQueries:adapter==="sqlite"?SqliteAdapter.prototype.iterateRecentQueries:SupabaseAdapter.prototype.iterateRecentQueries};
      const report=await readSourceLearning(store,source.id,network);
      expect(report).toMatchObject({excludedObservations:0,historicalUnclassifiedRuns:1,records:[{offered:2,bought:2,cited:2}]});
      expect(JSON.stringify(report)).not.toContain("hidden");expect(from).not.toHaveBeenCalled();
      expect(JSON.stringify(connection.prepare("SELECT * FROM query_runs ORDER BY id").all())).toBe(original);
      connection.prepare("UPDATE run_privacy SET visibility='unlisted',revision=revision+1 WHERE run_id=?").run(published[1].id);
      expect((await privacy.read(published[1].id)).item?.state.visibility).toBe("unlisted");
      expect((await readSourceLearning(store,source.id,network))!.records[0].offered).toBe(1);
      // A queued row revoked while the public iterator is paused consumes work and never refills.
      const iterator=store.iterateRecentQueries(3)[Symbol.asyncIterator]();expect((await iterator.next()).value?.id).toBe("run-3");
      connection.prepare("UPDATE run_privacy SET visibility='private' WHERE run_id=?").run(published[0].id);
      expect((await iterator.next()).done).toBe(true);
    } finally {connection.close();}
  });
  it("withholds missing/drifted active learning through API/page/MCP and preserves explicit OFF behavior",async()=>{
    const sourceRead=vi.fn(async()=>source),scan=vi.fn(async function*(){yield fixture().run;});
    for(const runPrivacy of [undefined,{list:vi.fn(async()=>{throw new Error("PRIVATE wrong schema");})} as unknown as ReturnType<typeof createSqliteRunPrivacy>]) {
      const store={runPrivacyActive:true,runPrivacy,getSource:sourceRead,iterateRecentQueries:scan},read=()=>readSourceLearning(store,source.id,network);
      await expect(read()).rejects.toThrow();expect(scan).not.toHaveBeenCalled();expect(sourceRead).not.toHaveBeenCalled();
      const response=await sourceLearningResponse(new Request("https://synthetic.example"),source.id,read);
      expect(response.status).toBe(503);expect(await response.text()).not.toContain("PRIVATE");
      const unavailable=await read().catch(()=>null),html=renderToStaticMarkup(createElement(SourceLearningPanel,{report:unavailable,sourceId:source.id}));
      expect(html).toContain("unavailable");expect(html).not.toContain("PRIVATE");
      let handler:()=>Promise<unknown>=async()=>undefined;
      registerSourceLearning({registerTool(_name,_options,callback){handler=()=>callback({sourceId:source.id});}},read);
      expect(await handler()).toMatchObject({isError:true});
    }
    vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED","true");
    expect((await readSourceLearning({runPrivacyActive:false,getSource:sourceRead,iterateRecentQueries:scan},source.id,network))!.records[0].offered).toBe(1);
  });
  it("bounds rejected learning work at300 and omits internal snapshots from public JSON/type while exact owner export survives until erasure",async()=>{
    let scanned=0;const run=fixture().run;
    const privacy={list:vi.fn(async()=>[]),read:vi.fn(async()=>({exists:true,item:{run,state:{visibility:"unlisted",revision:1,erased:false}}}))} as unknown as ReturnType<typeof createSqliteRunPrivacy>;
    const report=await readSourceLearning({runPrivacyActive:true,runPrivacy:privacy,getSource:async()=>source,async *iterateRecentQueries(){for(let i=0;i<400;i++){scanned++;yield {...run,id:`candidate-${i}`};}}},source.id,network);
    expect(report).toMatchObject({records:[],excludedObservations:0,historicalUnclassifiedRuns:0});expect(privacy.read).toHaveBeenCalledTimes(300);expect(scanned).toBe(300);
    const connection=new DatabaseSync(":memory:");installSqliteApplicationSchema(connection);connection.exec(RUN_PRIVACY_SQL);
    try {
      const original=Object.assign({budget:0,engine:"fixture",totalSpent:0,totalToCreators:0,subClaims:[],trace:[]},run);
      writeSqliteQueryRun(connection,original,true);const store=createSqliteRunPrivacy(connection),sessionHash="c".repeat(64),now=Date.now();
      connection.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(sessionHash,actor,now-1000,now+60000);
      const who={wallet:actor,sessionHash,binding:{network:"eip155:5042" as const,origin:"https://synthetic.example"}};
      await store.change(run.id,who,{visibility:"public",revision:0,requestId:randomUUID()});
      const stored=String(connection.prepare("SELECT data FROM query_runs WHERE id=?").get(run.id)!.data),projected=publicQueryRun((await store.read(run.id)).item!.run);
      expect(projected).not.toHaveProperty("sourceLearning");expect(JSON.stringify(projected)).not.toContain("accessMicros");
      // @ts-expect-error Public projection has no sourceLearning exposure authority.
      expect(projected.sourceLearning).toBeUndefined();
      expect((await store.export(run.id,who,randomUUID())).run.sourceLearning).toEqual(run.sourceLearning);
      expect(String(connection.prepare("SELECT data FROM query_runs WHERE id=?").get(run.id)!.data)).toBe(stored);
      await store.erase(run.id,who,{revision:1,requestId:randomUUID()});
      expect((await store.export(run.id,who,randomUUID())).run).not.toHaveProperty("sourceLearning");
    } finally {connection.close();}
  });
  it("counts retained exact settled outcomes and reveals only source-declared topics", () => {
    const { run } = fixture();
    expect(run.sourceLearning?.sources).toEqual([{ sourceId: source.id, topics: ["x402"], eligibility: "eligible", read: true, cached: false,
      bought: true, cited: true, accessMicros: "1000", contribution: 0.8 }]);
    expect(sourceLearningTopics(source, "secret-unpublished-123")).toEqual(["general"]);
    const report = aggregateSourceLearning(source.id, network, [run]);
    expect(report.records[0]).toMatchObject({ topic: "x402", offered: 1, read: 1, bought: 1, cited: 1, averageContribution: 0.8,
      averagePriceMicros: { numerator: "1000", denominator: 1 } });
    for (const secret of ["secret-unpublished", "private.example", actor, owner, "transaction", "payment-0", "run-0", "item-a"])
      expect(JSON.stringify(report)).not.toContain(secret);
  });
  it.each([owner, owner.toUpperCase().replace("0X", "0x"), author])("excludes source owner/beneficiary %s before cohort eligibility", wallet => {
    const independent = fixture().run, self = fixture(1, true, wallet).run;
    expect(self.sourceLearning?.sources[0].eligibility).toBe("owner");
    const before = aggregateSourceLearning(source.id, network, [independent]);
    const after = aggregateSourceLearning(source.id, network, [independent, self]);
    expect(after.records).toEqual(before.records); expect(after.excludedObservations).toBe(1);
  });
  it("excludes independent-looking input without trusted evidence and refuses offline/pending/no-read observations", () => {
    const { run, payments } = fixture();
    for (const candidate of [{ ...run, usage: undefined }, { ...run, paymentMode: "offline" as const },
      { ...run, usage: { ...run.usage!, cohort: "unknown" as const, payment: "unknown" as const, actorEvidenceSha256: null, fundingEvidenceSha256: null } }]) {
      if (!candidate.usage) {
        expect(() => captureSourceLearning({ run: candidate, sources: [source], terms: new Map([[source.id, terms]]), payments, readSourceIds: new Set([source.id]), readAssetIds: new Set(["asset-a"]) })).toThrow();
        continue;
      }
      const captured = captureSourceLearning({ run: candidate, sources: [source], terms: new Map([[source.id, terms]]), payments, readSourceIds: new Set([source.id]), readAssetIds: new Set(["asset-a"]) });
      expect(captured.sources[0].eligibility).not.toBe("eligible");
      expect(aggregateSourceLearning(source.id, network, [{ ...candidate, sourceLearning: captured }]).records).toEqual([]);
    }
    for (const payment of [{ ...payments[0], settled: false, settlementStatus: "pending" as const }, { ...payments[0], txHash: null },
      { ...payments[0], network: "eip155:5042002" }, { ...payments[0], contentVersion: undefined }]) {
      expect(captureSourceLearning({ run, sources: [source], terms: new Map([[source.id, terms]]), payments: [payment], readSourceIds: new Set([source.id]), readAssetIds: new Set(["asset-a"]) }).sources[0].bought).toBe(false);
    }
    expect(captureSourceLearning({ run, sources: [source], terms: new Map([[source.id, terms]]), payments, readSourceIds: new Set(), readAssetIds: new Set() }).sources[0].bought).toBe(false);
    // A different article from the same source was read; that cannot turn an unread debit into a purchased outcome.
    expect(captureSourceLearning({ run, sources: [source], terms: new Map([[source.id, terms]]), payments,
      readSourceIds: new Set([source.id]), readAssetIds: new Set(["other-version-asset"]) }).sources[0].bought).toBe(false);
  });
  it("bounds repeated traffic, ignores private jobs and historical unknowns, and flags sudden change", () => {
    const runs = Array.from({ length: 75 }, (_, i) => fixture(i, i < 5).run);
    const sameDay = { ...fixture(80).run, createdAt: runs[74].createdAt };
    const report = aggregateSourceLearning(source.id, network, [sameDay, ...runs]);
    expect(report.records[0].offered).toBe(60);
    const abrupt = aggregateSourceLearning(source.id, network, Array.from({ length: 10 }, (_, i) => fixture(i, i >= 5).run));
    expect(abrupt.records[0].shiftFlag).toBe(true);
    const privateRun = { ...runs[0], id: "prv_private", question: "PRIVATE BODY" };
    const old = { ...runs[0], id: "legacy", sourceLearning: undefined };
    expect(aggregateSourceLearning(source.id, network, [privateRun, old])).toMatchObject({ records: [], excludedObservations: 0, historicalUnclassifiedRuns: 1 });
    const duplicate = { ...runs[0], sourceLearning: { ...runs[0].sourceLearning!, sources: [{ ...runs[0].sourceLearning!.sources[0], cited: false, contribution: 0 }] } };
    expect(() => aggregateSourceLearning(source.id, network, [runs[0], duplicate])).toThrow("Conflicting learning run");
  });
  it("excludes malformed/duplicate snapshots and noncanonical day timestamps before counting", () => {
    const run = fixture().run, snapshot = run.sourceLearning!;
    for (const sources of [[...snapshot.sources, ...snapshot.sources], [{ ...snapshot.sources[0], topics: ["x402", "x402"] }],
      [{ ...snapshot.sources[0], read: false }], [{ ...snapshot.sources[0], bought: false }]]) {
      expect(aggregateSourceLearning(source.id, network, [{ ...run, sourceLearning: { ...snapshot, sources } }]).records).toEqual([]);
    }
    for (const createdAt of ["2026-10-01T01:00:00+01:00", "2026-10-01", "2026-10-01T00:00:00Z"])
      expect(aggregateSourceLearning(source.id, network, [{ ...run, createdAt }]).records).toEqual([]);
    const changedEvidence = { ...run, id: "same-wallet-new-evidence", usage: { ...run.usage!, actorEvidenceSha256: "f".repeat(64) } };
    expect(aggregateSourceLearning(source.id, network, [run, changedEvidence]).records[0].offered).toBe(1);
  });
  it("unions owner/beneficiary authority across every asset snapshot of a source", () => {
    const { run, payments } = fixture();
    const result = captureSourceLearning({ run, sources: [source], terms: new Map([[source.id, [{ ...terms, creator: actor }, terms]]]),
      payments, readSourceIds: new Set([source.id]), readAssetIds: new Set(["asset-a"]) });
    expect(result.sources[0].eligibility).toBe("owner");
    const newPayee = captureSourceLearning({ run, sources: [source], terms: new Map([[source.id, terms]]),
      payments: payments.map(p => ({ ...p, payee: actor })), readSourceIds: new Set([source.id]), readAssetIds: new Set(["asset-a"]) });
    expect(newPayee.sources[0].eligibility).toBe("owner");
    const stale = captureSourceLearning({ run, sources: [source], terms: new Map([[source.id, [{ ...terms, stale: true }, terms]]]),
      payments, readSourceIds: new Set([source.id]), readAssetIds: new Set(["asset-a"]) });
    expect(stale.sources[0].eligibility).toBe("authority-unavailable");
    const report = aggregateSourceLearning(source.id, network, [run]);
    for (const patch of [{ averageContribution: null }, { averageContribution: 1, cited: 0, smoothedCitationRate: 1 / 3 },
      { offered: 0, read: 0, cached: 0, bought: 0, cited: 0, smoothedCitationRate: null, uncertainty: null, averageContribution: null,
        averagePriceMicros: { numerator: "0", denominator: 0 }, lastObservedAt: null }])
      expect(() => validateSourceLearningReport({ ...report, records: [{ ...report.records[0], ...patch }] })).toThrow();
  });
  it("preserves API/page/MCP equivalence and uniform storage failure without a private selector", async () => {
    const runs = [fixture().run], privacy={list:vi.fn(async()=>[]),read:vi.fn(async()=>({exists:true,item:{run:runs[0],state:{visibility:"public",revision:0,erased:false}}}))} as unknown as ReturnType<typeof createSqliteRunPrivacy>;
    const store = {runPrivacyActive:true,runPrivacy:privacy, getSource: vi.fn(async () => source), async *iterateRecentQueries(limit: number) { expect(limit).toBe(300); yield* runs; } };
    const report = await readSourceLearning(store, source.id, network);
    const read = vi.fn(async () => report);
    const response = await sourceLearningResponse(new Request("https://keryx.cc"), source.id, read);
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(await response.json()).toEqual(report);
    const html = renderToStaticMarkup(createElement(SourceLearningPanel, { report, sourceId: source.id }));
    expect(html).toContain("x402"); expect(html).toContain("Recorded source outcomes"); expect(html).toContain("0% (0 USDC)");
    expect(html).toContain(`/api/source/${source.id}/learning`); expect(html).not.toContain("private.example");
    let handler: (value: unknown) => Promise<unknown> = async () => undefined;
    registerSourceLearning({ registerTool(name, options, callback) { expect(name).toBe("keryx_source_learning"); expect(options.annotations.readOnlyHint).toBe(true); handler = callback; } }, read);
    expect(await handler({ sourceId: source.id })).toEqual({ content: [{ type: "text", text: JSON.stringify(report) }] });
    read.mockClear();
    expect((await sourceLearningResponse(new Request("https://keryx.cc/?owner=private"), source.id, read)).status).toBe(400);
    expect(await handler({ sourceId: source.id, owner: "private" })).toMatchObject({ isError: true }); expect(read).not.toHaveBeenCalled();
    const unavailable = await sourceLearningResponse(new Request("https://keryx.cc"), source.id, async () => { throw new Error("PRIVATE STORE TOKEN"); });
    expect(unavailable.status).toBe(503); expect(await unavailable.text()).not.toContain("TOKEN");
    expect(() => validateSourceLearningReport({ ...report, sourceId: "another" }, source.id)).toThrow();
  });
});
