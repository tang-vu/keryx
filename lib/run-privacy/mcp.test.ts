import {DatabaseSync} from "node:sqlite";
import {randomUUID} from "node:crypto";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {InMemoryTransport} from "@modelcontextprotocol/sdk/inMemory.js";
import {expect,it,vi} from "vitest";
import {installSqliteApplicationSchema} from "../db/sqlite-application-schema";
import {writeSqliteQueryRun} from "../db/query-run-record";
import {RUN_PRIVACY_SQL,createSqliteRunPrivacy} from "../db/run-privacy-sqlite";
import type {ApiKeyScope} from "../api-key-scopes";
const database=vi.hoisted(()=>vi.fn());
vi.mock("../db",()=>({getDb:database}));
vi.mock("../config",()=>({config:{networkId:"eip155:5042002",baseUrl:"https://synthetic-privacy.example"}}));
import {createRemoteMcpServer} from "../mcp/remote-server";
import {privacyBinding} from "./auth";

it("guards actual MCP owner export before journal reads and preserves amounts without custody bindings",async()=>{
  const connection=new DatabaseSync(":memory:"),wallet=`0x${"a".repeat(40)}`,foreign=`0x${"b".repeat(40)}`;
  installSqliteApplicationSchema(connection);connection.exec(RUN_PRIVACY_SQL);
  const date=new Date().toISOString(),run={id:"owned",createdAt:date,asker:wallet,question:"PRIVATE question",answer:"PRIVATE answer",
    budget:0.1,engine:"fixture",totalSpent:0.01,totalToCreators:0.000001,subClaims:[],decisions:[],citations:[],trace:[]};
  writeSqliteQueryRun(connection,run,false);
  const payment={id:"fixture",queryId:run.id,kind:"citation",sourceId:"source",sourceName:"Source",amountUsdc:0.000001,
    payer:wallet,payee:foreign,network:"eip155:5042002",settled:true,settlementStatus:"settled",createdAt:date,
    authorizationId:"CUSTODIAN nonce",grantEpoch:"CUSTODIAN grant",rationale:"PRIVATE rationale"};
  const stored=JSON.stringify(payment),payments=vi.fn(async()=>[payment]);
  const store=createSqliteRunPrivacy(connection);
  database.mockResolvedValue({runPrivacy:store,listCreatorPaymentAttemptsByQuery:payments});
  const research=vi.fn(async()=>{throw new Error("Research is forbidden in this fixture");});
  const invoke=async(actor:string|undefined,historyScopes:ApiKeyScope[],id=run.id)=>{
    const server=createRemoteMcpServer({budgetCap:0,clientChannel:"other",actor,historyScopes},research);
    const client=new Client({name:"privacy-fixture",version:"1"});
    const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);await client.connect(clientTransport);
      return await client.callTool({name:"run_owner_export",arguments:{id,requestId:randomUUID()}});
    } finally {await client.close();await server.close();}
  };
  try {
    expect((await store.owner(run.id,{wallet,binding:privacyBinding()}))?.run.question).toBe(run.question);
    const missingScope=await invoke(wallet,[]),crossOwner=await invoke(foreign,["history:read"]),unknown=await invoke(wallet,["history:read"],"unknown");
    for(const response of [missingScope,crossOwner,unknown])expect(response.isError).toBe(true);
    expect(crossOwner.content).toEqual(unknown.content);expect(payments).not.toHaveBeenCalled();
    const exported=await invoke(wallet,["history:read"]);
    expect(exported.isError).not.toBe(true);expect(exported.structuredContent).toMatchObject({wallet,run:{question:run.question,answer:run.answer},
      state:{visibility:"private",revision:0,erased:false},payments:[{amountUsdc:payment.amountUsdc,settled:true,settlementStatus:"settled"}]});
    const packet=JSON.stringify(exported);expect(packet).not.toContain("CUSTODIAN");expect(packet).not.toContain("PRIVATE rationale");
    expect(payments).toHaveBeenCalledExactlyOnceWith(run.id);expect(JSON.stringify(payment)).toBe(stored);expect(research).not.toHaveBeenCalled();
    expect(connection.prepare("SELECT count(*) n FROM run_privacy_audit WHERE action='export'").get()?.n).toBe(1);
  } finally {connection.close();database.mockReset();}
});
