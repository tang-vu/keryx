import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { DatabaseSync } from "node:sqlite";
import { SqliteAdapter } from "../db/sqlite-adapter";
import { writeSqliteQueryRun } from "../db/query-run-record";
import { RUN_PRIVACY_SQL } from "../db/run-privacy-sqlite";
import type { PaymentRecord } from "../types";
import {
  EARNINGS_COLUMNS,
  buildEarningsRows,
  summariseEarnings,
  type EarningsExportRow,
} from "./earnings-export";
import { exportFilename, toCsv as writeCsv } from "./csv";

const toCsv = (rows: EarningsExportRow[]) => writeCsv(EARNINGS_COLUMNS, rows);
const routeDb=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/db",()=>({getDb:routeDb}));
import { GET as creatorExport } from "@/app/api/creator/[id]/export/route";
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
    amountUsdc: 0.0001,
    network: "eip155:5042002",
    settled: true,
    createdAt: "2026-07-19T10:00:00.000Z",
    ...over,
  };
}

describe("buildEarningsRows", () => {
  it("does not include sponsored operator charges or inbound service revenue in creator earnings", () => {
    const rows = [payment(), payment({ kind: "operating-fee", amountUsdc: 0.02 }),
      payment({ kind: "inbound", amountUsdc: 0.03 })];
    expect(buildEarningsRows(rows, new Map(), "https://keryx.cc")).toHaveLength(1);
    expect(summariseEarnings(rows)).toMatchObject({ paymentCount: 1, citationCount: 1,
      totalUsdc: 0.0001, settledUsdc: 0.0001 });
  });
  it("carries the question and a resolvable dispatch link", () => {
    const rows = buildEarningsRows(
      [payment({ queryId: "abc" })],
      new Map([["abc", "Who pays for AI training data?"]]),
      "https://keryx.cc/",
    );
    expect(rows[0].question).toBe("Who pays for AI training data?");
    expect(rows[0].dispatch_url).toBe("https://keryx.cc/dispatch/abc");
  });

  it("keeps payouts whose question is unknown", () => {
    const rows = buildEarningsRows([payment()], new Map(), "https://keryx.cc");
    expect(rows).toHaveLength(1);
    expect(rows[0].question).toBe("");
  });

  it("renders micro-rewards at USDC precision, never in exponent form", () => {
    const rows = buildEarningsRows(
      [payment({ amountUsdc: 0.0000001 + 0.0000002 })],
      new Map(),
      "https://keryx.cc",
    );
    expect(rows[0].amount_usdc).toBe("0.000000");
    expect(rows[0].amount_usdc).not.toMatch(/e/i);
  });

  it("leaves weight blank for fetch tolls that carry none", () => {
    const rows = buildEarningsRows(
      [payment({ kind: "fetch", weight: undefined })],
      new Map(),
      "https://keryx.cc",
    );
    expect(rows[0].weight).toBe("");
  });

  it("distinguishes a submitted authorization from an offline simulation", () => {
    const rows = buildEarningsRows(
      [
        payment({
          settled: false,
          settlementStatus: "pending",
          authorizationId: "nonce-1",
          txHash: null,
        }),
      ],
      new Map(),
      "https://keryx.cc",
    );
    expect(rows[0]).toMatchObject({
      settled: "no",
      settlement_status: "pending",
      authorization_id: "nonce-1",
      settlement_ref: "",
    });
  });
});

describe("toCsv", () => {
  it("emits the declared header in order", () => {
    expect(toCsv([]).split("\r\n")[0]).toBe(EARNINGS_COLUMNS.join(","));
  });

  it("quotes and doubles quotes inside a question", () => {
    const rows = buildEarningsRows(
      [payment()],
      new Map([["q1", 'He said "buy", then left']]),
      "https://keryx.cc",
    );
    expect(toCsv(rows)).toContain('"He said ""buy"", then left"');
  });

  it("neutralises a question a spreadsheet would run as a formula", () => {
    const rows = buildEarningsRows(
      [payment()],
      new Map([["q1", "=cmd|'/c calc'!A1"]]),
      "https://keryx.cc",
    );
    const cells = toCsv(rows);
    // Leading apostrophe: the cell is inert text. No quoting needed — it holds no comma.
    expect(cells).toContain(`,'=cmd|'/c calc'!A1,`);
    expect(cells).not.toMatch(/,=cmd/);
  });

  it("keeps a newline inside a question on one logical row", () => {
    const rows = buildEarningsRows(
      [payment()],
      new Map([["q1", "line one\nline two"]]),
      "https://keryx.cc",
    );
    const csv = toCsv(rows);
    expect(csv).toContain('"line one\nline two"');
    // header + one data record, both terminated
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(2);
  });
});

describe("summariseEarnings", () => {
  it("splits citations from tolls and counts only settled money as settled", () => {
    const s = summariseEarnings([
      payment({ kind: "citation", amountUsdc: 0.002, createdAt: "2026-07-18T00:00:00.000Z" }),
      payment({ kind: "fetch", amountUsdc: 0.001, settled: false }),
    ]);
    expect(s.paymentCount).toBe(2);
    expect(s.citationCount).toBe(1);
    expect(s.fetchCount).toBe(1);
    expect(s.totalUsdc).toBe(0.003);
    expect(s.settledUsdc).toBe(0.002);
    expect(s.firstPaymentAt).toBe("2026-07-18T00:00:00.000Z");
    expect(s.lastPaymentAt).toBe("2026-07-19T10:00:00.000Z");
  });

  it("reports an empty ledger without dates", () => {
    const s = summariseEarnings([]);
    expect(s).toMatchObject({ paymentCount: 0, totalUsdc: 0, firstPaymentAt: null });
  });
});

describe("exportFilename", () => {
  it("strips path characters out of a source id", () => {
    expect(exportFilename("../../etc/passwd", "csv")).not.toContain("/");
    expect(exportFilename("latent-space", "json")).toMatch(
      /^keryx-earnings-latent-space-\d{4}-\d{2}-\d{2}\.json$/,
    );
  });
});

describe("actual creator earnings export privacy boundary",()=>{
  const baseUrl="https://synthetic-privacy.example",wallet=`0x${"b".repeat(40)}`;
  async function fixture(active:boolean,admitted=true) {
    vi.stubEnv("BASE_URL",baseUrl);vi.stubEnv("KERYX_RUN_PRIVACY_ENABLED",active?"true":"");
    const db=new SqliteAdapter(":memory:");openFixtures.push(db);await db.init();
    const connection=(db as unknown as {db:DatabaseSync}).db;
    if(active&&admitted){connection.exec(RUN_PRIVACY_SQL);await db.init();}
    await db.upsertSource({id:"s1",name:"Fixture creator",walletAddress:wallet,authors:[],url:`${baseUrl}/s1`,description:"Fixture",fetchPrice:0,tags:[],createdAt:"2026-10-12T00:00:00.000Z"});
    for(const [index,id] of ["private","unlisted","public"].entries()) {
      const original = {id,asker:`0x${"a".repeat(40)}`,createdAt:`2026-10-12T00:00:0${index}.000Z`,question:`QUESTION ${id}`,answer:`ANSWER ${id}`,
        engine:"fixture",budget:0,totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[]};
      // Seed the retained original before privacy admission; the reader must still refuse.
      if(active&&!admitted)writeSqliteQueryRun(connection,original,false);
      else await db.saveQueryRun(original);
      if(active&&admitted)connection.prepare("UPDATE run_privacy SET visibility=? WHERE run_id=?").run(id,id);
      await db.recordPayment(payment({id:`payment-${id}`,queryId:id,sourceName:"Fixture creator",payer:`0x${"a".repeat(40)}`,payee:wallet,
        amountUsdc:[0.000001,0.012345,0.300003][index],settled:index===0,settlementStatus:["settled","pending","failed"][index] as PaymentRecord["settlementStatus"],
        txHash:`circle-settlement-${id}`,authorizationId:`=HYPERLINK("https://custody.invalid","R3-private-nonce-${id}"),\nraw`,
        authorizationExpiresAt:"2026-10-12T01:00:00.000Z",grantEpoch:`R3-private-grant-${id}`,rationale:`R3-private-rationale-${id}`,
        createdAt:`2026-10-12T00:00:0${index}.000Z`}));
    }
    routeDb.mockResolvedValue(db);return {db,connection};
  }
  const request=(format:string)=>new NextRequest(`${baseUrl}/api/creator/s1/export?format=${format}`);
  const params={params:Promise.resolve({id:"s1"})};
  it.each(["csv","json"])("active actual creator %s projects raw persisted custody fields before serialization without changing money/columns/proofs",async format=>{
    const {db,connection}=await fixture(true);
    const before=connection.prepare("SELECT * FROM payment_events ORDER BY id").all(),raw=await db.listPaymentsBySource("s1");
    expect(raw.every(row=>row.authorizationId?.includes("R3-private-nonce"))).toBe(true);
    const response=await creatorExport(request(format),params);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");
    const text=await response.text();expect(text).not.toContain("R3-private");expect(text).not.toContain("QUESTION private");expect(text).not.toContain("QUESTION unlisted");
    const expected=buildEarningsRows(raw,new Map([["public","QUESTION public"]]),baseUrl).map(row=>({...row,authorization_id:""}));
    if(format==="csv")expect(text).toBe(toCsv(expected));
    else {const packet=JSON.parse(text);expect(packet.payments).toEqual(expected);expect(Object.keys(packet.payments[0])).toEqual(EARNINGS_COLUMNS);expect(packet.summary).toEqual(summariseEarnings(raw));}
    expect(expected.map(row=>row.amount_usdc)).toEqual(["0.300003","0.012345","0.000001"]);
    expect(expected.map(row=>[row.settled,row.settlement_status,row.settlement_ref])).toEqual([["no","failed","circle-settlement-public"],["no","pending","circle-settlement-unlisted"],["yes","settled","circle-settlement-private"]]);
    expect(connection.prepare("SELECT * FROM payment_events ORDER BY id").all()).toEqual(before);
  });
  it.each(["csv","json"])("inactive actual creator %s preserves the complete legacy admitted serializer output",async format=>{
    const {db,connection}=await fixture(false);const raw=await db.listPaymentsBySource("s1"),before=connection.prepare("SELECT * FROM payment_events ORDER BY id").all();
    const rows=buildEarningsRows(raw,new Map(raw.map(row=>[row.queryId,`QUESTION ${row.queryId}`])),baseUrl);
    const response=await creatorExport(request(format),params);expect(response.status).toBe(200);const text=await response.text();expect(text).toContain("R3-private-nonce");
    if(format==="csv")expect(text).toBe(toCsv(rows));else{const packet=JSON.parse(text);expect(packet.payments).toEqual(rows);expect(packet.summary).toEqual(summariseEarnings(raw));}
    expect(connection.prepare("SELECT * FROM payment_events ORDER BY id").all()).toEqual(before);
  });
  it.each(["missing","drifted"])("active actual creator refuses %s privacy admission before reading raw journals, even for an empty ledger",async admission=>{
    const {db,connection}=await fixture(true,admission!=="missing");if(admission==="drifted")connection.exec("DROP TRIGGER run_privacy_new");
    const journals=vi.spyOn(db,"listPaymentsBySource");journals.mockResolvedValue([]);
    const response=await creatorExport(request("json"),params);expect(response.status).toBe(500);expect(await response.json()).toEqual({error:"privacy_unavailable"});expect(journals).not.toHaveBeenCalled();
  });
});
