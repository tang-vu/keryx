import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DatabaseSync } from "node:sqlite";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { writeSqliteQueryRun } from "../db/query-run-record";
import { RUN_PRIVACY_SQL } from "../db/run-privacy-sqlite";
import { summariseEarnings } from "./earnings-export";
import type { PaymentRecord } from "../types";
import { toCsv } from "./csv";
import {
  PORTFOLIO_COLUMNS,
  buildPortfolioRows,
  sortNewestFirst,
  summarisePortfolioBySource,
} from "./portfolio-export";
const route=vi.hoisted(()=>({db:vi.fn(),session:vi.fn(),key:vi.fn(),rate:vi.fn()}));
vi.mock("@/lib/db",()=>({getDb:route.db}));
vi.mock("@/lib/auth",()=>({getSession:route.session}));
vi.mock("@/lib/api-keys",()=>({verifyApiKey:route.key}));
vi.mock("@/lib/rate-limit",()=>({checkRateLimit:route.rate}));
import { GET as portfolioExport } from "@/app/api/creator/export/route";
const openFixtures:SqliteAdapter[]=[];
afterEach(()=>{for(const db of openFixtures.splice(0))db.close();vi.unstubAllEnvs();vi.restoreAllMocks();});

function payment(over: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    kind: "citation",
    queryId: "q1",
    sourceId: "s1",
    sourceName: "Latent Space",
    payer: "0xpayer",
    payee: "0xpayee",
    amountUsdc: 0.003,
    network: "eip155:5042002",
    settled: true,
    createdAt: "2026-07-19T10:00:00.000Z",
    ...over,
  };
}

describe("buildPortfolioRows", () => {
  it("excludes operating fees without shifting the remaining source and payout columns", () => {
    const payments = [payment({ kind: "operating-fee", sourceId: "keryx:operating-fee", amountUsdc: 0.02 }),
      payment({ sourceId: "writer", sourceName: "Writer", amountUsdc: 0.003 }),
      payment({ kind: "inbound", sourceId: "customer", amountUsdc: 0.03 })];
    expect(buildPortfolioRows(payments, new Map(), "https://keryx.cc")).toMatchObject([
      { source_id: "writer", source_name: "Writer", amount_usdc: "0.003000" },
    ]);
    expect(summarisePortfolioBySource(payments)).toMatchObject([{ sourceId: "writer", totalUsdc: 0.003 }]);
  });
  it("labels each payout with the source that earned it", () => {
    const rows = buildPortfolioRows(
      [payment({ sourceId: "s2", sourceName: "Stablecoin Ledger" })],
      new Map([["q1", "Who pays for training data?"]]),
      "https://keryx.cc",
    );
    expect(rows[0].source_id).toBe("s2");
    expect(rows[0].source_name).toBe("Stablecoin Ledger");
    expect(rows[0].question).toBe("Who pays for training data?");
  });

  it("stays row-aligned when payouts span sources", () => {
    const rows = buildPortfolioRows(
      [payment({ sourceId: "a", amountUsdc: 0.001 }), payment({ sourceId: "b", amountUsdc: 0.002 })],
      new Map(),
      "https://keryx.cc",
    );
    expect(rows.map((r) => [r.source_id, r.amount_usdc])).toEqual([
      ["a", "0.001000"],
      ["b", "0.002000"],
    ]);
  });

  it("writes the source columns first so a pivot reads them as keys", () => {
    const csv = toCsv(
      PORTFOLIO_COLUMNS,
      buildPortfolioRows([payment()], new Map(), "https://keryx.cc"),
    );
    expect(csv.split("\r\n")[0]).toMatch(/^source_id,source_name,date,/);
  });
});

describe("summarisePortfolioBySource", () => {
  it("groups by source, biggest earner first, settled counted separately", () => {
    const totals = summarisePortfolioBySource([
      payment({ sourceId: "small", sourceName: "Small", amountUsdc: 0.001 }),
      payment({ sourceId: "big", sourceName: "Big", amountUsdc: 0.01 }),
      payment({ sourceId: "big", sourceName: "Big", amountUsdc: 0.005, settled: false }),
    ]);
    expect(totals.map((t) => t.sourceId)).toEqual(["big", "small"]);
    expect(totals[0]).toMatchObject({ paymentCount: 2, totalUsdc: 0.015, settledUsdc: 0.01 });
  });

  it("does not accumulate float dust across many micro-rewards", () => {
    const many = Array.from({ length: 10 }, () => payment({ amountUsdc: 0.0001 }));
    expect(summarisePortfolioBySource(many)[0].totalUsdc).toBe(0.001);
  });

  it("returns nothing for an empty ledger", () => {
    expect(summarisePortfolioBySource([])).toEqual([]);
  });
});

describe("sortNewestFirst", () => {
  it("merges sources into one statement ordered by time, not by source", () => {
    const sorted = sortNewestFirst([
      payment({ sourceId: "a", createdAt: "2026-07-01T00:00:00.000Z" }),
      payment({ sourceId: "b", createdAt: "2026-07-19T00:00:00.000Z" }),
      payment({ sourceId: "a", createdAt: "2026-07-10T00:00:00.000Z" }),
    ]);
    expect(sorted.map((p) => p.createdAt.slice(0, 10))).toEqual([
      "2026-07-19",
      "2026-07-10",
      "2026-07-01",
    ]);
  });

  it("leaves the caller's array untouched", () => {
    const input = [
      payment({ createdAt: "2026-07-01T00:00:00.000Z" }),
      payment({ createdAt: "2026-07-19T00:00:00.000Z" }),
    ];
    sortNewestFirst(input);
    expect(input[0].createdAt.slice(0, 10)).toBe("2026-07-01");
  });
});

describe("actual creator portfolio export privacy boundary",()=>{
  const baseUrl="https://synthetic-privacy.example",wallet=`0x${"b".repeat(40)}`;
  async function fixture(active:boolean,admitted=true) {
    vi.stubEnv("BASE_URL",baseUrl);vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED",active?"true":"");
    const db=new SqliteAdapter(":memory:");openFixtures.push(db);await db.init();
    const connection=(db as unknown as {db:DatabaseSync}).db;
    if(active&&admitted){connection.exec(RUN_PRIVACY_SQL);await db.init();}
    for(const id of ["s1","s2"])await db.upsertSource({id,name:`Fixture ${id}`,walletAddress:wallet,authors:[],url:`${baseUrl}/${id}`,description:"Fixture",fetchPrice:0,tags:[],createdAt:"2026-10-12T00:00:00.000Z",active:id==="s1"});
    for(const [index,id] of ["private","unlisted","public"].entries()) {
      const original = {id,asker:`0x${"a".repeat(40)}`,createdAt:`2026-10-12T00:00:0${index}.000Z`,question:`QUESTION ${id}`,answer:`ANSWER ${id}`,
        engine:"fixture",budget:0,totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[]};
      // Seed the retained original before privacy admission; the reader must still refuse.
      if(active&&!admitted)writeSqliteQueryRun(connection,original,false);
      else await db.saveQueryRun(original);
      if(active&&admitted)connection.prepare("UPDATE run_privacy SET visibility=? WHERE run_id=?").run(id,id);
      await db.recordPayment(payment({id:`payment-${id}`,queryId:id,sourceId:index===2?"s2":"s1",sourceName:index===2?"Fixture s2":"Fixture s1",payer:`0x${"a".repeat(40)}`,payee:wallet,
        amountUsdc:[0.000001,0.012345,0.300003][index],settled:index===0,settlementStatus:["settled","pending","failed"][index] as PaymentRecord["settlementStatus"],
        txHash:`circle-settlement-${id}`,authorizationId:`=HYPERLINK("https://custody.invalid","R3-private-nonce-${id}"),\nraw`,
        authorizationExpiresAt:"2026-10-12T01:00:00.000Z",grantEpoch:`R3-private-grant-${id}`,rationale:`R3-private-rationale-${id}`,
        createdAt:`2026-10-12T00:00:0${index}.000Z`}));
    }
    route.db.mockResolvedValue(db);route.session.mockResolvedValue({address:wallet});route.rate.mockResolvedValue(null);
    return {db,connection};
  }
  const request=(format:string)=>new NextRequest(`${baseUrl}/api/creator/export?format=${format}`);
  const rawPayments=async(db:SqliteAdapter)=>sortNewestFirst((await Promise.all([db.listPaymentsBySource("s1"),db.listPaymentsBySource("s2")])).flat());
  it.each(["csv","json"])("active actual portfolio %s projects raw persisted custody fields before serialization without changing source alignment/money/proofs",async format=>{
    const {db,connection}=await fixture(true);const before=connection.prepare("SELECT * FROM payment_events ORDER BY id").all(),raw=await rawPayments(db);
    expect(raw.every(row=>row.authorizationId?.includes("R3-private-nonce"))).toBe(true);
    const response=await portfolioExport(request(format));expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store, private");
    const text=await response.text();expect(text).not.toContain("R3-private");expect(text).not.toContain("QUESTION private");expect(text).not.toContain("QUESTION unlisted");
    const expected=buildPortfolioRows(raw,new Map([["public","QUESTION public"]]),baseUrl).map(row=>({...row,authorization_id:""}));
    if(format==="csv")expect(text).toBe(toCsv(PORTFOLIO_COLUMNS,expected));
    else {const packet=JSON.parse(text);expect(packet.payments).toEqual(expected);expect(Object.keys(packet.payments[0])).toEqual(PORTFOLIO_COLUMNS);expect(packet.summary).toEqual(summariseEarnings(raw));expect(packet.bySource).toEqual(summarisePortfolioBySource(raw));expect(packet.sources).toContainEqual({id:"s2",name:"Fixture s2",walletAddress:wallet,active:false});}
    expect(expected.map(row=>[row.source_id,row.amount_usdc,row.settlement_status,row.settlement_ref])).toEqual([["s2","0.300003","failed","circle-settlement-public"],["s1","0.012345","pending","circle-settlement-unlisted"],["s1","0.000001","settled","circle-settlement-private"]]);
    expect(connection.prepare("SELECT * FROM payment_events ORDER BY id").all()).toEqual(before);
  });
  it.each(["csv","json"])("inactive actual portfolio %s preserves the complete legacy admitted serializer output",async format=>{
    const {db,connection}=await fixture(false);const raw=await rawPayments(db),before=connection.prepare("SELECT * FROM payment_events ORDER BY id").all();
    const rows=buildPortfolioRows(raw,new Map(raw.map(row=>[row.queryId,`QUESTION ${row.queryId}`])),baseUrl);
    const response=await portfolioExport(request(format));expect(response.status).toBe(200);const text=await response.text();expect(text).toContain("R3-private-nonce");
    if(format==="csv")expect(text).toBe(toCsv(PORTFOLIO_COLUMNS,rows));else{const packet=JSON.parse(text);expect(packet.payments).toEqual(rows);expect(packet.summary).toEqual(summariseEarnings(raw));expect(packet.bySource).toEqual(summarisePortfolioBySource(raw));}
    expect(connection.prepare("SELECT * FROM payment_events ORDER BY id").all()).toEqual(before);
  });
  it.each(["missing","drifted"])("active actual portfolio refuses %s privacy admission before reading raw journals, even for an empty ledger",async admission=>{
    const {db,connection}=await fixture(true,admission!=="missing");if(admission==="drifted")connection.exec("DROP TRIGGER run_privacy_new");
    const journals=vi.spyOn(db,"listPaymentsBySource");journals.mockResolvedValue([]);
    const response=await portfolioExport(request("json"));expect(response.status).toBe(500);expect(await response.json()).toEqual({error:"privacy_unavailable"});expect(journals).not.toHaveBeenCalled();
  });
});
