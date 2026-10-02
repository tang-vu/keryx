import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { SqliteAdapter } from "./sqlite-adapter";
import { SupabaseAdapter, assembleAuthorityBoundSupabaseCore } from "./supabase-adapter";
import { syntheticStorageIdentity } from "./storage-identity-fixture";
import { installOrdinarySqliteApplicationSchema } from "./sqlite-application-schema";
import { inspectSqliteEnrollment, enrollSqliteStorage } from "./storage-identity-provision";
import { initializeSqliteResearchMonthly, monthlyOrderId, monthlyOrderToRow, monthlyPurchaseId, MONTHLY_TERM_MS, type MonthlyPurchase, type ResearchPurchaseClaim } from "./research-monthly";
import { a2aOrderId, a2aRequestHash, type A2aOrder } from "../a2a/order";
import { a2aResearchPackage } from "../a2a/research-package";

const dbFile=path.join(os.tmpdir(),`keryx-monthly-${process.pid}.sqlite`);
const db=new SqliteAdapter(dbFile);
await db.init();
afterAll(()=>{db.close();for(const suffix of ["","-wal","-shm"]) fs.rmSync(dbFile+suffix,{force:true});});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});
function purchase(nonce: string): MonthlyPurchase {
  const identity={network:"eip155:5042002",payer:"0x1111111111111111111111111111111111111111",payee:"0x2222222222222222222222222222222222222222",authorizationId:nonce};
  const createdAt="2026-10-01T00:00:00.000Z";
  return {id:monthlyPurchaseId(identity),payer:identity.payer,payee:identity.payee,authorizationId:nonce,transaction:`circle-${nonce}`,quoteId:"a".repeat(64),createdAt,
    expiresAt:new Date(Date.parse(createdAt)+MONTHLY_TERM_MS).toISOString(),creatorBudgetMicros:50000,serviceFeeMicros:180000,totalMicros:380000,researchPackage:a2aResearchPackage("deep")};
}
function order(parent: MonthlyPurchase, request: string, question="What evidence supports Arc finality?"): A2aOrder {
  const id=monthlyOrderId(parent.id,request);
  const value={id,queryId:id,authorizationId:`${parent.authorizationId}:monthly:${request}`,payer:parent.payer,payee:parent.payee,amountUsdc:parent.totalMicros/4/1e6,
    creatorBudgetUsdc:parent.creatorBudgetMicros/1e6,serviceFeeUsdc:parent.serviceFeeMicros/4/1e6,researchMode:parent.researchPackage.researchMode,researchPackage:parent.researchPackage,
    status:"running" as const,transaction:parent.transaction,request:{question,origin:"a2a" as const,monthlyId:parent.id},startedAt:null,workerId:null,executionJournalVersion:1 as const,
    paymentStartedAt:null,resultSavingAt:null,response:null,errorCode:null,resolution:null,createdAt:parent.createdAt,updatedAt:parent.createdAt};
  return {...value,requestHash:a2aRequestHash({...value,question})};
}
function redeem(parent:MonthlyPurchase,request:string, overrides:Partial<A2aOrder>={}) {
  return db.redeemResearchMonthly({monthlyId:parent.id,payer:parent.payer,requestId:request,now:parent.createdAt,order:{...order(parent,request),...overrides}});
}
function claim(parent:MonthlyPurchase,purpose:ResearchPurchaseClaim["purpose"]="monthly"):ResearchPurchaseClaim {
  return {network:"eip155:5042002",payer:parent.payer,payee:parent.payee,authorizationId:parent.authorizationId,purpose,requestHash:parent.quoteId,amountMicros:parent.totalMicros};
}

describe("Monthly SQLite economic admission",()=>{
  it("requires a server-issued nonce, commits submission before Circle, and retains exact uncertain replay",async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-02T00:00:00.000Z"));
    const seconds=Math.floor(Date.now()/1000),issued={validAfter:String(seconds-600),validBefore:String(seconds+691200),expiresAt:String(seconds+600)};
    const unknown=purchase("unrecorded-historical"),required={...claim(unknown),issued,requireExisting:true};
    await expect(db.claimResearchPurchase(required)).rejects.toThrow("conflict");
    const raw=new DatabaseSync(dbFile);
    try {
      expect(raw.prepare("SELECT count(*) AS n FROM research_purchase_authorizations WHERE authorization_id=?").get(unknown.authorizationId)?.n).toBe(0);
      const unissued=purchase("historical-missing-issuance");await db.claimResearchPurchase(claim(unissued));
      await expect(db.claimResearchPurchase({...claim(unissued),issued,requireExisting:true})).rejects.toThrow("mismatch");
      const parent=purchase("issued-before-exposure");await db.claimResearchPurchase({...claim(parent),issued});
      const saved=()=>JSON.parse(String(raw.prepare("SELECT issued_data FROM research_purchase_authorizations WHERE authorization_id=?").get(parent.authorizationId)?.issued_data));
      expect(saved()).toEqual({...issued,submitted:false});
      await db.claimResearchPurchase({...claim(parent),issued,requireExisting:true});
      expect(saved()).toEqual({...issued,submitted:true});
      await expect(db.claimResearchPurchase({...claim(parent,"a2a"),issued,requireExisting:true})).rejects.toThrow();
      await expect(db.claimResearchPurchase({...claim(parent),issued:{...issued,expiresAt:String(seconds+599)},requireExisting:true})).rejects.toThrow("mismatch");
      expect(()=>raw.prepare("UPDATE research_purchase_authorizations SET issued_data=? WHERE authorization_id=?").run(JSON.stringify({...issued,submitted:false}),parent.authorizationId)).toThrow("immutable");
      vi.setSystemTime(new Date((seconds+601)*1000));
      await db.claimResearchPurchase({...claim(parent),issued,requireExisting:true});
      await db.claimResearchPurchase(claim(parent));
      expect(saved()).toEqual({...issued,submitted:true});
    } finally {raw.close();}
  });
  it("expires never-submitted challenges and refuses malformed or oversized validity contexts without insertion",async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-02T00:00:00.000Z"));
    const seconds=Math.floor(Date.now()/1000),issued={validAfter:String(seconds-600),validBefore:String(seconds+691200),expiresAt:String(seconds+600)};
    const parent=purchase("never-submitted-expiry");await db.claimResearchPurchase({...claim(parent),issued});
    for(const altered of [{...issued,expiresAt:String(seconds+661)},{...issued,validBefore:String(seconds+600)},
      {...issued,validAfter:String(seconds-661)},{...issued,validBefore:String(seconds+2592001)}])
      await expect(db.claimResearchPurchase({...claim(purchase("invalid-issued")),issued:altered})).rejects.toThrow();
    vi.setSystemTime(new Date((seconds+600)*1000));
    await expect(db.claimResearchPurchase({...claim(parent),issued,requireExisting:true})).rejects.toThrow("expired");
    const raw=new DatabaseSync(dbFile);
    try {expect(JSON.parse(String(raw.prepare("SELECT issued_data FROM research_purchase_authorizations WHERE authorization_id=?").get(parent.authorizationId)?.issued_data)).submitted).toBe(false);}
    finally{raw.close();}
  });
  it("accepts bounded issuance delay while preserving the original challenge expiry",async()=>{
    vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-02T00:00:00.000Z"));
    const seconds=Math.floor(Date.now()/1000),issued={validAfter:String(seconds-600),validBefore:String(seconds+691200),expiresAt:String(seconds+600)};
    for(const skew of [-2,2]) {
      vi.setSystemTime(new Date((seconds+skew)*1000));
      const parent=purchase(`issued-delayed-${skew}`);await db.claimResearchPurchase({...claim(parent),issued});
      vi.setSystemTime(new Date((seconds+600)*1000));
      await expect(db.claimResearchPurchase({...claim(parent),issued,requireExisting:true})).rejects.toThrow("expired");
      await expect(db.claimResearchPurchase({...claim(parent),issued:{...issued,expiresAt:String(seconds+602)},requireExisting:true})).rejects.toThrow("mismatch");
    }
  });
  it("pins the exact settled purchase, package, quote and thirty-day term",async()=>{
    const parent=purchase("purchase-replay");
    expect((await db.createResearchMonthly(parent)).created).toBe(true);
    expect(await db.createResearchMonthly(parent)).toEqual({created:false,purchase:parent});
    for(const altered of [ {...parent,transaction:"other-settlement"}, {...parent,quoteId:"b".repeat(64)},
      {...parent,creatorBudgetMicros:50001,totalMicros:380004}, {...parent,expiresAt:"2026-11-02T00:00:00.000Z"},
      {...parent,researchPackage:{...parent.researchPackage,execution:{attentionLimit:99,reevaluateRounds:1}}},
      {...parent,serviceFeeMicros:180001,totalMicros:380001}]) await expect(db.createResearchMonthly(altered)).rejects.toThrow();
    expect(await db.getResearchMonthly(parent.id)).toEqual({purchase:parent,redemptions:[]});
  });
  it("retains verified admission without granting an entitlement and excludes cross-purpose/payee reuse",async()=>{
    const parent=purchase("preclaim");
    await db.claimResearchPurchase(claim(parent));
    await db.claimResearchPurchase({...claim(parent),payer:parent.payer.toUpperCase().replace("0X","0x"),authorizationId:parent.authorizationId.toUpperCase()});
    expect(await db.getResearchMonthly(parent.id)).toBeNull();
    for(const changed of [{...claim(parent),purpose:"a2a" as const},{...claim(parent),purpose:"resource" as const},
      {...claim(parent),payee:"0x3333333333333333333333333333333333333333"},{...claim(parent),amountMicros:380004},
      {...claim(parent),requestHash:"b".repeat(64)},{...claim(parent),network:"eip155:1"}]) await expect(db.claimResearchPurchase(changed)).rejects.toThrow();
    expect((await db.createResearchMonthly(parent)).created).toBe(true);
  });
  it("binds existing A2A inserts to admission and excludes Monthly reuse",async()=>{
    const parent=purchase("a2a-first");
    const direct={...order(parent,"direct"),id:a2aOrderId({network:"eip155:5042002",...parent}),authorizationId:parent.authorizationId};
    direct.queryId=direct.id;
    await db.createA2aOrder(direct);
    await expect(db.createResearchMonthly(parent)).rejects.toThrow();
    const monthlyFirst=purchase("monthly-first");await db.createResearchMonthly(monthlyFirst);
    await expect(db.createA2aOrder({...direct,id:a2aOrderId({network:"eip155:5042002",...monthlyFirst}),queryId:a2aOrderId({network:"eip155:5042002",...monthlyFirst}),authorizationId:monthlyFirst.authorizationId})).rejects.toThrow();
  });
  it("backfills historical resource nonces as unbound and refuses ambiguous identities atomically",async()=>{
    const raw = new DatabaseSync(":memory:");
    try {
      raw.exec(`CREATE TABLE a2a_orders(id TEXT,payer TEXT,payee TEXT,authorization_id TEXT,request_hash TEXT,amount_usdc REAL);
        CREATE TABLE payment_events(id TEXT,payer TEXT,payee TEXT,network TEXT,authorization_id TEXT,amount_usdc REAL,kind TEXT,query_id TEXT);`);
      const parent=purchase("historical");
      raw.prepare("INSERT INTO payment_events VALUES (?,?,?,?,?,?,?,?)").run("payment",parent.payer,parent.payee,"eip155:5042002",parent.authorizationId,.38,"fetch","resource");
      initializeSqliteResearchMonthly(raw);
      expect(raw.prepare("SELECT product,request_hash FROM research_purchase_authorizations").get()).toEqual({product:"resource",request_hash:"legacy:unbound"});
      raw.prepare("INSERT INTO payment_events VALUES (?,?,?,?,?,?,?,?)").run("conflicting",parent.payer,"0x3333333333333333333333333333333333333333","eip155:5042002",parent.authorizationId,.38,"fetch","resource");
      expect(()=>initializeSqliteResearchMonthly(raw)).toThrow("Ambiguous historical");
      expect(raw.prepare("SELECT count(*) AS n FROM research_purchase_authorizations").get()?.n).toBe(1);
    } finally { raw.close(); }
  });
  it("refuses historical cross-purpose delivery even when the payee and amount agree",()=>{
    for (const [kind,queryId] of [["fetch","other-query"],["inbound","other-query"],["inbound","a2a_historical"]]) {
      const raw=new DatabaseSync(":memory:");
      try {
        raw.exec(`CREATE TABLE a2a_orders(id TEXT,payer TEXT,payee TEXT,authorization_id TEXT,request_hash TEXT,amount_usdc REAL);
          CREATE TABLE payment_events(id TEXT,payer TEXT,payee TEXT,network TEXT,authorization_id TEXT,amount_usdc REAL,kind TEXT,query_id TEXT);`);
        const parent=purchase("cross-purpose");
        raw.prepare("INSERT INTO a2a_orders VALUES (?,?,?,?,?,?)").run("a2a_historical",parent.payer,parent.payee,parent.authorizationId,parent.quoteId,.38);
        raw.prepare("INSERT INTO payment_events VALUES (?,?,?,?,?,?,?,?)").run("payment",parent.payer,parent.payee,"eip155:5042002",parent.authorizationId,.38,kind,queryId);
        if (kind==="inbound" && queryId==="a2a_historical") {
          initializeSqliteResearchMonthly(raw);
          expect(raw.prepare("SELECT count(*) AS n FROM research_purchase_authorizations").get()?.n).toBe(1);
        } else {
          expect(()=>initializeSqliteResearchMonthly(raw)).toThrow("Ambiguous historical");
          expect(raw.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='research_purchase_authorizations'").get()?.n).toBe(0);
        }
      } finally {raw.close();}
    }
  });
});
describe("Monthly atomic request consumption",()=>{
  it("consumes exactly four requests under contention, preserving failed and ambiguous slots",async()=>{
    const parent=purchase("bounded");await db.createResearchMonthly(parent);
    const results=await Promise.allSettled(Array.from({length:8},(_,n)=>redeem(parent,`request-${n}`)));
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(4);
    const saved=await db.getResearchMonthly(parent.id);
    expect(saved?.redemptions.map(value=>value.slot)).toEqual([0,1,2,3]);
    await db.failA2aOrder(saved!.redemptions[0]!.orderId,"research_failed",parent.createdAt);
    await expect(redeem(parent,"replacement")).rejects.toThrow("limit");
    const request="request-0",input={monthlyId:parent.id,payer:parent.payer,requestId:request,now:parent.expiresAt,order:order(parent,request)};
    expect(await db.redeemResearchMonthly(input)).toMatchObject({created:false,order:{status:"failed"}});
    const changed=order(parent,request,"A different question");
    await expect(db.redeemResearchMonthly({...input,order:changed})).rejects.toThrow("conflict");
    const raw=new DatabaseSync(dbFile);
    expect(raw.prepare("SELECT count(*) AS n FROM payment_events WHERE query_id IN (SELECT order_id FROM research_monthly_redemptions)").get()?.n).toBe(0);
    expect(raw.prepare("SELECT count(*) AS n FROM research_purchase_authorizations WHERE authorization_id LIKE '%:monthly:%'").get()?.n).toBe(0);
    raw.close();
  });
  it("serializes two connections and replays the same request once",async()=>{
    const second=new SqliteAdapter(dbFile);await second.init();
    try {
      const parent=purchase("two-connections");await db.createResearchMonthly(parent);
      const input={monthlyId:parent.id,payer:parent.payer,requestId:"same",now:parent.createdAt,order:order(parent,"same")};
      const result=await Promise.all([db.redeemResearchMonthly(input),second.redeemResearchMonthly(input)]);
      expect(result.map(value=>value.created).sort()).toEqual([false,true]);
      expect((await db.getResearchMonthly(parent.id))?.redemptions).toHaveLength(1);
    } finally {second.close();}
  });
  it("rolls back every malformed or foreign order without consuming a slot",async()=>{
    const parent=purchase("rejections");await db.createResearchMonthly(parent);
    for(const override of [{amountUsdc:0.1},{creatorBudgetUsdc:0.06},{serviceFeeUsdc:0.05},{transaction:"different"},
      {queryId:"wrong"},{authorizationId:"wrong"},{requestHash:"b".repeat(64)},{startedAt:parent.createdAt},
      {workerId:"worker"},{executionJournalVersion:null},{paymentStartedAt:parent.createdAt},{resultSavingAt:parent.createdAt},
      {response:{}},{status:"completed" as const},{researchPackage:a2aResearchPackage("quick")},
      {request:{question:"q",origin:"a2a" as const}},{payer:"0x3333333333333333333333333333333333333333"}]) await expect(redeem(parent,"invalid",override)).rejects.toThrow();
    await expect(db.redeemResearchMonthly({monthlyId:parent.id,payer:parent.payer,requestId:"expired",now:parent.expiresAt,order:order(parent,"expired")})).rejects.toThrow("expired");
    const colliding=order(parent,"collision");await db.createA2aOrder(colliding);
    await expect(redeem(parent,"collision")).rejects.toThrow();
    expect((await db.getResearchMonthly(parent.id))?.redemptions).toEqual([]);
    expect((await redeem(parent,"valid")).created).toBe(true);
  });
  it("fails closed on malformed stored purchases",async()=>{
    const raw=new DatabaseSync(dbFile),id=monthlyPurchaseId({network:"eip155:5042002",payer:purchase("bad").payer,payee:purchase("bad").payee,authorizationId:"bad"});
    raw.prepare("INSERT INTO research_monthly (id,payer,data) VALUES (?,?,?)").run(id,purchase("bad").payer,'{"id":"malformed"}');raw.close();
    await expect(db.getResearchMonthly(id)).rejects.toThrow();
  });
});

it("Supabase uses atomic RPCs and validates returned immutable contracts",async()=>{
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://synthetic-db.example");vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","synthetic-key-no-authority");
  const parent=purchase("supabase"),child=order(parent,"request");
  const http=vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(true)).mockResolvedValueOnce(Response.json({created:true,purchase:parent}))
    .mockResolvedValueOnce(Response.json({purchase:parent,redemptions:[]})).mockResolvedValueOnce(Response.json({created:true,order:monthlyOrderToRow(child)}));
  vi.stubGlobal("fetch",http);const remote=new SupabaseAdapter();
  await remote.claimResearchPurchase(claim(parent));expect((await remote.createResearchMonthly(parent)).created).toBe(true);
  expect((await remote.redeemResearchMonthly({monthlyId:parent.id,payer:parent.payer,requestId:"request",now:parent.createdAt,order:child})).created).toBe(true);
  expect(http.mock.calls.map(call=>String(call[0]).split("/rpc/")[1])).toEqual(["claim_research_purchase","create_research_monthly","get_research_monthly","redeem_research_monthly"]);
  expect(JSON.parse(String(http.mock.calls[3]![1]?.body))).toMatchObject({p_id:parent.id,p_request_id:"request",p_order:{id:child.id,started_at:null,request_data:{monthlyId:parent.id}}});
  http.mockResolvedValueOnce(Response.json({created:false,purchase:{...parent,transaction:"tampered"}}));
  await expect(remote.createResearchMonthly(parent)).rejects.toThrow("conflict");
});

it("Supabase sends strict issued admission without a caller-controlled submitted marker",async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-02T00:00:00.000Z"));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://synthetic-db.example");vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","synthetic-key-no-authority");
  const seconds=Math.floor(Date.now()/1000),issued={validAfter:String(seconds-600),validBefore:String(seconds+691200),expiresAt:String(seconds+600)};
  const http=vi.fn<typeof fetch>().mockResolvedValue(Response.json(true));vi.stubGlobal("fetch",http);
  const remote=new SupabaseAdapter(),parent=purchase("supabase-required-issued");
  await remote.claimResearchPurchase({...claim(parent),issued,requireExisting:true});
  expect(JSON.parse(String(http.mock.calls[0]![1]?.body))).toEqual({p_claim:{network:"eip155:5042002",asset:"0x3600000000000000000000000000000000000000",
    payer:parent.payer,payee:parent.payee,authorization_id:parent.authorizationId,product:"monthly",purchase_id:parent.id,
    request_hash:parent.quoteId,amount_micros:parent.totalMicros,issued_data:issued,requireExisting:true}});
  await expect(remote.claimResearchPurchase({...claim(parent),issued:{...issued,submitted:true} as typeof issued,requireExisting:true})).rejects.toThrow();
  expect(http).toHaveBeenCalledTimes(1);
});

it("refuses enrolled SQLite and Supabase cores before legacy schema or transport access",async()=>{
  const raw=new DatabaseSync(":memory:"),prepare=vi.spyOn(raw,"prepare"),identity=syntheticStorageIdentity("testnet-offline");
  const sqlite=SqliteAdapter.assembleConnectionCore(raw,identity,()=>{});
  const rpc=vi.fn(),from=vi.fn();
  const deployment={format:"keryx-storage-deployment-v1" as const,identity,backend:{kind:"supabase" as const,url:"https://synthetic-db.invalid"}};
  const {adapter:supabase}=assembleAuthorityBoundSupabaseCore({rpc,from} as never,deployment,()=>deployment);
  try {
    for(const method of ["claimResearchPurchase","createResearchMonthly","getResearchMonthly","redeemResearchMonthly"] as const) {
      await expect(Reflect.apply(sqlite[method],sqlite,[])).rejects.toThrow("unavailable in enrolled storage");
      await expect(Reflect.apply(supabase[method],supabase,[])).rejects.toThrow();
    }
    expect(prepare).not.toHaveBeenCalled();expect(rpc).not.toHaveBeenCalled();expect(from).not.toHaveBeenCalled();
  } finally {prepare.mockRestore();raw.close();}
});

it("refuses an ordinary/raw handle pointed at an enrolled SQLite marker without creating Monthly schema",()=>{
  const raw=new DatabaseSync(":memory:");
  try {
    raw.exec("CREATE TABLE keryx_storage_identity(singleton INTEGER,identity TEXT)");
    expect(()=>initializeSqliteResearchMonthly(raw)).toThrow("unavailable in enrolled storage");
    expect(()=>installOrdinarySqliteApplicationSchema(raw)).toThrow("unavailable in enrolled storage");
    expect(raw.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE 'research_%'").get()?.n).toBe(0);
    expect(raw.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all()).toEqual([{name:"keryx_storage_identity"}]);
  } finally {raw.close();}
});

it("refuses ordinary adapter initialization before PRAGMAs or schema mutation on an enrolled marker",async()=>{
  const file=path.join(os.tmpdir(),`keryx-monthly-marker-${process.pid}.sqlite`);
  const raw=new DatabaseSync(file);raw.exec("CREATE TABLE keryx_storage_identity(singleton INTEGER,identity TEXT)");raw.close();
  const bytes=fs.readFileSync(file),adapter=new SqliteAdapter(file);
  try {
    await expect(adapter.init()).rejects.toThrow("unavailable in enrolled storage");
    expect(fs.readFileSync(file)).toEqual(bytes);
    expect(fs.existsSync(`${file}-wal`)).toBe(false);
  } finally {adapter.close();for(const suffix of ["","-wal","-shm"])fs.rmSync(file+suffix,{force:true});}
});

it("retains strict enrollment refusal for an ordinary Monthly-bearing database without mutation",async()=>{
  const file=path.join(os.tmpdir(),`keryx-monthly-unenrolled-${process.pid}.sqlite`),adapter=new SqliteAdapter(file);
  try {
    await adapter.init();adapter.close();
    const bytes=fs.readFileSync(file),identity=syntheticStorageIdentity("testnet-real");
    const inspection=await inspectSqliteEnrollment(file,identity);
    await expect(enrollSqliteStorage(file,identity,{format:"keryx-reviewed-storage-enrollment-v1",inspection,
      provenanceDocumentDigest:identity.provenanceDigest,unknownClassAttestation:inspection.unknownClasses})).rejects.toThrow("unsupported_table");
    expect(fs.readFileSync(file)).toEqual(bytes);
    const raw=new DatabaseSync(file,{readOnly:true});
    try {expect(raw.prepare("SELECT name FROM sqlite_schema WHERE name='keryx_storage_identity'").get()).toBeUndefined();}finally{raw.close();}
  } finally {try{adapter.close();}catch{}for(const suffix of ["","-wal","-shm"])fs.rmSync(file+suffix,{force:true});}
});
