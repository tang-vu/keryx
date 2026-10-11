import {randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {NextRequest} from "next/server";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {installSqliteApplicationSchema} from "../db/sqlite-application-schema";
import {writeSqliteQueryRun} from "../db/query-run-record";
import {createSqliteRunPrivacy,RUN_PRIVACY_SQL} from "../db/run-privacy-sqlite";
import type {PrivacyActor} from "./contracts";
const mocks=vi.hoisted(()=>({db:vi.fn(),actor:vi.fn()}));
vi.mock("@/lib/db",()=>({getDb:mocks.db}));
vi.mock("@/lib/agent",()=>({collectRun:vi.fn(),getAgentDeps:vi.fn()}));
vi.mock("@/lib/run-privacy/auth",()=>({requestPrivacyActor:mocks.actor}));
import {GET} from "@/app/api/agent/ask/route";
const wallet=`0x${"a".repeat(40)}`,other=`0x${"b".repeat(40)}`,id=`a2a_${"d".repeat(64)}`;
const actor:PrivacyActor={wallet,sessionHash:"a".repeat(64),binding:{network:"eip155:5042002",origin:"https://synthetic-privacy.example"}};
let connection:DatabaseSync,store:ReturnType<typeof createSqliteRunPrivacy>,order:ReturnType<typeof vi.fn>;
beforeEach(()=>{
  vi.resetAllMocks();connection=new DatabaseSync(":memory:");installSqliteApplicationSchema(connection);connection.exec(RUN_PRIVACY_SQL);
  const now=Date.now();connection.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(actor.sessionHash!,wallet,now-1000,now+60000);
  writeSqliteQueryRun(connection,{id,asker:wallet,createdAt:new Date(now).toISOString(),question:"SECRET question",answer:"SECRET answer",budget:0.1,engine:"fixture",totalSpent:0.012345,totalToCreators:0.000001,subClaims:[],decisions:[],citations:[],trace:[]},true);
  store=createSqliteRunPrivacy(connection);order=vi.fn(async()=>({queryId:id,status:"completed",response:{answer:"SECRET answer"},amountUsdc:0.03,creatorBudgetUsdc:0.01,serviceFeeUsdc:0.02}));
  mocks.db.mockResolvedValue({runPrivacy:store,getA2aOrder:order,listCreatorPaymentAttemptsByQuery:async()=>[]});mocks.actor.mockResolvedValue(undefined);
});
afterEach(()=>connection.close());
const read=(queryId=id)=>GET(new NextRequest(`https://synthetic-privacy.example/api/agent/ask?queryId=${queryId}&wallet=${wallet}&payer=${wallet}`));
it("makes private and unknown polls indistinguishable before any eager order read, including caller wallet guesses",async()=>{
  const hidden=await read(),missing=await read(`a2a_${"e".repeat(64)}`);
  expect(hidden.status).toBe(404);expect(missing.status).toBe(404);expect(await hidden.text()).toEqual(await missing.text());
  expect([...hidden.headers]).toEqual([...missing.headers]);expect(order).not.toHaveBeenCalled();
});
it.each(["public","unlisted"] as const)("serves a valid %s link with unchanged financial response values",async visibility=>{
  await store.change(id,actor,{revision:0,visibility,requestId:randomUUID()});
  const response=await read();expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("no-store");expect(await response.json()).toMatchObject({answer:"SECRET answer",totalToCreators:0,pricing:{serviceFeeUsdc:0.02}});
  expect(order).toHaveBeenCalledExactlyOnceWith(id);
});
it("allows the authenticated run owner and denies a different authenticated owner",async()=>{
  mocks.actor.mockResolvedValue({...actor,wallet:other});expect((await read()).status).toBe(404);expect(order).not.toHaveBeenCalled();
  mocks.actor.mockResolvedValue(actor);expect((await read()).status).toBe(200);expect(order).toHaveBeenCalledTimes(1);
});
it("refuses inadmitted or revoked-key paths before reading any order body",async()=>{
  mocks.db.mockResolvedValue({runPrivacyActive:true,getA2aOrder:order});expect((await read()).status).toBe(503);expect(order).not.toHaveBeenCalled();
  mocks.actor.mockResolvedValue(Response.json({error:"unauthenticated"},{status:401}));expect((await read()).status).toBe(401);expect(order).not.toHaveBeenCalled();
});
it("preserves the default-OFF admitted completed poll and exact financial response without privacy authentication",async()=>{
  mocks.db.mockResolvedValue({runPrivacyActive:false,getA2aOrder:order,listCreatorPaymentAttemptsByQuery:async()=>[]});
  mocks.actor.mockRejectedValue(new Error("Privacy authentication must not run while inactive"));
  const response=await read();expect(response.status).toBe(200);expect(await response.json()).toMatchObject({answer:"SECRET answer",pricing:{serviceFeeUsdc:0.02}});
  expect(mocks.actor).not.toHaveBeenCalled();expect(order).toHaveBeenCalledExactlyOnceWith(id);
});
it.each([null,new Date().toISOString(),"2026-01-01T00:00:00.000Z"])("serves bounded active pending status (%s) without worker/question/answer reads",async started=>{
  const pendingId=`a2a_${"f".repeat(64)}`,created=new Date().toISOString(),transaction=`0x${"c".repeat(64)}`;
  connection.prepare(`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,
    status,transaction_id,request_data,response_data,started_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(pendingId,pendingId,"PRIVATE nonce","PRIVATE hash",wallet,other,0.030001,0.010001,0.02,"deep","running",transaction,
      JSON.stringify({question:"PRIVATE request"}),JSON.stringify({answer:"PRIVATE result"}),started,created,created);
  const before=connection.prepare("SELECT * FROM a2a_orders WHERE id=?").get(pendingId);
  const response=await read(pendingId),packet=await response.json();expect(response.status).toBe(200);
  expect(packet).toMatchObject({queryId:pendingId,status:started===null?"queued":started.startsWith("2026-01")?"review_required":"processing",
    financial:{totalPricePaid:0.030001,creatorBudgetUsdc:0.010001,serviceFeeUsdc:0.02,transaction}});
  expect(JSON.stringify(packet)).not.toContain("PRIVATE");expect(order).not.toHaveBeenCalled();
  expect(connection.prepare("SELECT * FROM a2a_orders WHERE id=?").get(pendingId)).toEqual(before);
});

function pendingReference(transaction:string) {
  const pendingId=`a2a_${"f".repeat(64)}`,created=new Date().toISOString();
  connection.prepare(`INSERT INTO a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,
    status,transaction_id,request_data,response_data,started_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(pendingId,pendingId,"PRIVATE nonce","PRIVATE hash",wallet,other,0.030001,0.010001,0.02,"deep","running",transaction,
      JSON.stringify({question:"PRIVATE request"}),JSON.stringify({answer:"PRIVATE result"}),null,created,created);
  return {pendingId,created,before:connection.prepare("SELECT * FROM a2a_orders WHERE id=?").get(pendingId)};
}
it.each(["original-circle-reference","circle-transfer","CiRcLe_Transfer:Ref-01",`0x${"c".repeat(64)}`,`0x${"A".repeat(64)}`,"","A".repeat(256)])(
  "preserves public-safe pending reference: %s in SQLite and actual HTTP without finality or worker-body claims",async transaction=>{
    const {pendingId,created,before}=pendingReference(transaction);
    expect(await store.pending(pendingId)).toEqual({queryId:pendingId,status:"running",createdAt:created,startedAt:null,
      amountUsdc:0.030001,creatorBudgetUsdc:0.010001,serviceFeeUsdc:0.02,transaction});
    const response=await read(pendingId);expect(response.status).toBe(200);const packet=await response.json();
    expect(packet).toEqual({status:"queued",queryId:pendingId,pollUrl:`/api/agent/ask?queryId=${pendingId}`,createdAt:created,startedAt:null,
      financial:{totalPricePaid:0.030001,creatorBudgetUsdc:0.010001,serviceFeeUsdc:0.02,transaction},
      qualification:"Recorded pending status and accepted financial values; no result or completed settlement is asserted."});
    expect(JSON.stringify(packet)).not.toContain("PRIVATE");expect(order).not.toHaveBeenCalled();
    expect(connection.prepare("SELECT * FROM a2a_orders WHERE id=?").get(pendingId)).toEqual(before);
  });
it.each(["https://private.invalid/token","Bearer PRIVATE_NONCE",'{"authorization":"PRIVATE_NONCE"}',"header.payload.signature",
  "circle-transfer\nPRIVATE_NONCE","circle-transfer\n"," circle-transfer","círcleref","A".repeat(257)])(
  "refuses unsafe pending reference: %s in SQLite and actual HTTP without journal rewrite or raw fallback",async transaction=>{
    const {pendingId,before}=pendingReference(transaction);await expect(store.pending(pendingId)).rejects.toThrow();
    const response=await read(pendingId);expect(response.status).toBe(503);expect(await response.json()).toEqual({error:"privacy_unavailable"});
    expect(order).not.toHaveBeenCalled();expect(connection.prepare("SELECT * FROM a2a_orders WHERE id=?").get(pendingId)).toEqual(before);
  });
