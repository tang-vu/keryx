import {DatabaseSync} from "node:sqlite";
import {createHash,randomUUID} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {NextRequest} from "next/server";
import {installSqliteApplicationSchema} from "../db/sqlite-application-schema";
import {writeSqliteQueryRun} from "../db/query-run-record";
import {RUN_PRIVACY_SQL,createSqliteRunPrivacy} from "../db/run-privacy-sqlite";
const auth=vi.hoisted(()=>({session:vi.fn(),key:vi.fn(),db:vi.fn(),page:vi.fn()}));
vi.mock("../account-sessions",()=>({accountSessionContext:auth.session}));
vi.mock("../api-keys",()=>({verifyApiKey:auth.key}));
vi.mock("../db",()=>({getDb:auth.db}));
vi.mock("../auth",()=>({getSession:auth.page}));
vi.mock("../config",()=>({config:{networkId:"eip155:5042002",baseUrl:"https://synthetic-privacy.example",profile:{networkId:"eip155:5042002"}}}));
vi.mock("../history/testnet-archive",()=>({getTestnetArchive:async()=>null}));
import {privacyDefaults,privacyRun} from "./http";
import {GET as dispatch} from "@/app/api/dispatch/[id]/route";
import {GET as receipt} from "@/app/api/dispatch/[id]/receipt/route";
import {GET as activity} from "@/app/api/activity/route";
import {settlementReceipt} from "./public";
import {createRunPrivacyClient} from "./client";
import {buildResearchReceipt} from "../research-receipt";
import {GET as runs} from "@/app/api/runs/route";
const wallet=`0x${"a".repeat(40)}`,other=`0x${"b".repeat(40)}`,session=createHash("sha256").update(wallet).digest("hex"),origin="https://synthetic-privacy.example";
let connection:DatabaseSync;
beforeEach(()=>{
  vi.clearAllMocks();connection=new DatabaseSync(":memory:");installSqliteApplicationSchema(connection);connection.exec(RUN_PRIVACY_SQL);
  const date=new Date().toISOString();connection.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(session,wallet,Date.now()-1000,Date.now()+60000);
  const store=createSqliteRunPrivacy(connection),payments=[{id:"synthetic",kind:"citation",queryId:"owned",sourceId:"s",sourceName:"Public source",payer:wallet,payee:other,amountUsdc:0.000001,network:"eip155:5042002",settled:true,settlementStatus:"settled",createdAt:date,rationale:"SECRET rationale",authorizationId:"CUSTODIAN nonce",grantEpoch:"CUSTODIAN binding",authorizationPhase:"prepared"}];
  const db={runPrivacy:store,listCreatorPaymentAttemptsByQuery:async()=>payments,listPayments:async()=>payments};auth.db.mockResolvedValue(db);
  auth.session.mockResolvedValue({db,wallet,currentId:session});auth.page.mockResolvedValue({address:wallet});auth.key.mockResolvedValue({walletAddress:wallet,scopes:"history:read"});
  for(const id of ["owned","linked","demo"])writeSqliteQueryRun(connection,{id,createdAt:date,asker:wallet,question:`SECRET ${id}`,answer:"SECRET answer",budget:0.1,engine:"fixture",totalSpent:0.01,totalToCreators:0.000001,subClaims:[],decisions:[],citations:[],trace:[]},false);
  connection.prepare("UPDATE run_privacy SET visibility='unlisted' WHERE run_id='linked'").run();connection.prepare("UPDATE run_privacy SET visibility='public' WHERE run_id='demo'").run();
});
afterEach(()=>connection.close());
const request=(path:string,method="GET",body?:unknown,headers:Record<string,string>={})=>new NextRequest(`${origin}${path}`,{method,headers:{Origin:origin,"X-Keryx-Expected-Wallet":wallet,...(body?{"Content-Type":"application/json"}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
const params=(id:string)=>({params:Promise.resolve({id})});
describe("#266 public routes and signed owner actions",()=>{
  it("preserves inactive ordinary dispatch/list/v1 receipt and gates every new owner control before authentication",async()=>{
    const legacy=JSON.parse(String(connection.prepare("SELECT data FROM query_runs WHERE id='owned'").get()?.data));
    const db={runPrivacyActive:false,getQueryRun:async(id:string)=>id===legacy.id?legacy:null,listRecentQueries:async()=>[legacy],
      listCreatorPaymentAttemptsByQuery:async()=>[],runPrivacy:undefined};auth.db.mockResolvedValue(db);
    const result=await dispatch(new NextRequest(`${origin}/api/dispatch/owned`,{headers:{Authorization:"Bearer invalid"}}),params("owned"));
    expect(result.status).toBe(200);expect((await result.json()).question).toBe(legacy.question);expect(auth.key).not.toHaveBeenCalled();
    const packet=await(await receipt(new Request(`${origin}/api/dispatch/owned/receipt`),params("owned"))).json();expect(packet).toEqual(buildResearchReceipt(legacy,[]));
    expect((await(await runs(new Request(`${origin}/api/runs`))).json())[0].id).toBe(legacy.id);
    for(const action of ["owner","export","visibility","erase"] as const)expect((await privacyRun(request("/"),legacy.id,action)).status).toBe(503);
    expect((await privacyDefaults(request("/"))).status).toBe(503);expect((await privacyDefaults(request("/"),true)).status).toBe(503);
    expect(auth.session).not.toHaveBeenCalled();expect(connection.prepare("SELECT count(*) n FROM run_privacy_audit").get()?.n).toBe(0);
  });
  it("makes private nonowner and unknown reads byte-equal while valid unlisted links and public reads work",async()=>{
    auth.page.mockResolvedValue(null);
    const privateResponse=await dispatch(request("/api/dispatch/owned","GET",undefined,{"X-Keryx-Expected-Wallet":""}),params("owned"));
    // Anonymous links omit the optional owner precondition entirely.
    const read=(id:string)=>dispatch(new NextRequest(`${origin}/api/dispatch/${id}`),params(id));
    const a=await read("owned"),b=await read("unknown");expect(a.status).toBe(404);expect(b.status).toBe(404);expect(await a.text()).toBe(await b.text());expect([...a.headers]).toEqual([...b.headers]);
    expect((await(await read("linked")).json()).answer).toBe("SECRET answer");expect((await read("demo")).status).toBe(200);
    expect(privateResponse.status).toBe(409);
  });
  it("requires configured Origin, expected owner and atomic active session for visibility/default/erase",async()=>{
    const body={visibility:"public",revision:0,requestId:randomUUID()};
    expect((await privacyRun(request("/","PATCH",body,{Origin:"https://foreign.example"}),"owned","visibility")).status).toBe(403);
    expect((await privacyRun(request("/","PATCH",body,{"X-Keryx-Expected-Wallet":other}),"owned","visibility")).status).toBe(409);
    expect((await privacyRun(request("/","PATCH",body),"owned","visibility")).status).toBe(200);
    expect((await privacyDefaults(request("/","PATCH",{visibility:"public",requestId:randomUUID()}),true)).status).toBe(200);
    connection.prepare("DELETE FROM web_sessions WHERE hash=?").run(session);
    expect((await privacyRun(request("/","DELETE",{revision:1,requestId:randomUUID()}),"owned","erase")).status).toBe(401);
  });
  it("never falls back from invalid or under-scoped bearer to cookie and denies foreign owner exports",async()=>{
    expect((await privacyRun(request("/","GET",undefined,{Authorization:"Bearer invalid"}),"owned","owner")).status).toBe(401);
    auth.key.mockResolvedValue({walletAddress:wallet,scopes:"research:write"});expect((await privacyRun(request("/","GET",undefined,{Authorization:`Bearer kx_live_${"a".repeat(96)}`}),"owned","owner")).status).toBe(403);
    auth.page.mockResolvedValue({address:other});expect((await privacyRun(new NextRequest(`${origin}/`),"owned","owner")).status).toBe(404);
    expect((await privacyRun(new NextRequest(`${origin}/`,{headers:{"X-Keryx-Request-Id":randomUUID()}}),"owned","export")).status).toBe(404);
  });
  it("exports then erases owner text with audit, no-store and question-free public financial proofs",async()=>{
    const exported=await privacyRun(request("/","GET",undefined,{"X-Keryx-Request-Id":randomUUID()}),"owned","export");expect(exported.status).toBe(200);expect(exported.headers.get("cache-control")).toBe("no-store");const packet=await exported.json();expect(packet.run.question).toBe("SECRET owned");expect(JSON.stringify(packet.payments)).not.toContain("CUSTODIAN");expect(packet.payments[0].amountUsdc).toBe(0.000001);
    const before=await(await receipt(new Request(`${origin}/api/dispatch/owned/receipt`),params("owned"))).json();expect(before.schema).toBe("urn:keryx:settlement-receipt:1");expect(JSON.stringify(before)).not.toContain("SECRET");expect(JSON.stringify(before)).not.toContain("CUSTODIAN");
    expect((await privacyRun(request("/","DELETE",{revision:0,requestId:randomUUID()}),"owned","erase")).status).toBe(200);
    const after=await(await receipt(new Request(`${origin}/api/dispatch/owned/receipt`),params("owned"))).json();expect(after).toEqual(before);
    const event=await activity();expect(JSON.stringify(await event.json())).not.toContain("SECRET owned");
    expect(connection.prepare("SELECT count(*) n FROM run_privacy_audit").get()?.n).toBe(2);
  });
  it("keeps stdio owner reads on the fixed bounded HTTPS endpoint with no cookie, redirect or signer",async()=>{
    const fetcher=vi.fn(async()=>Response.json({wallet,run:{id:"owned",createdAt:new Date().toISOString(),question:"SECRET",answer:"SECRET",budget:0,engine:"fixture",totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[]},state:{visibility:"private",revision:0,erased:false}}));
    const key=`kx_live_${"a".repeat(96)}`,client=createRunPrivacyClient(origin,()=>key,fetcher);
    expect((await client.read("owned")).run.id).toBe("owned");expect(fetcher).toHaveBeenCalledWith(new URL(`${origin}/api/me/run-privacy/owned`),expect.objectContaining({credentials:"omit",redirect:"error",cache:"no-store"}));
    expect(()=>createRunPrivacyClient("http://foreign.example",()=>key)).toThrow();
  });
});
