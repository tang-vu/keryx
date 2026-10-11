import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { installSqliteApplicationSchema } from "../db/sqlite-application-schema";
import { writeSqliteQueryRun } from "../db/query-run-record";
import { createSqliteRunPrivacy, RUN_PRIVACY_SQL } from "../db/run-privacy-sqlite";
import { createSqliteRunClaims, RUN_CLAIMS_SQL } from "../db/run-claims-sqlite";
import { createSqliteRunOwnershipHistory } from "../db/run-ownership-history-sqlite";
import { createSqlitePublicUsage } from "../db/public-usage-sqlite";
import { PrivacyError, type PrivacyActor, type RunVisibility } from "./contracts";
import { listedQuestion, settlementReceipt,publicFinancialPayment } from "./public";
import type { QueryRun } from "../types";
import {withRunReadProjection} from "./projection";
import {projectRecordedEvidenceProvenance,SYNTHETIC_EVIDENCE_NOTICE} from "../research/evidence-provenance";

const connections:DatabaseSync[]=[];
const alice=`0x${"a".repeat(40)}`,bob=`0x${"b".repeat(40)}`, hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const binding={network:"eip155:5042002" as const,origin:"https://synthetic-privacy.example"};
const actor=(wallet=alice):PrivacyActor=>({wallet,binding,sessionHash:hash(wallet)});
afterEach(()=>{connections.splice(0).forEach(db=>db.close());});
function fixture() {
  const db=new DatabaseSync(":memory:");connections.push(db);installSqliteApplicationSchema(db);db.exec(RUN_CLAIMS_SQL);
  const now=Date.now(),date=new Date(now-1000).toISOString();
  for(const wallet of [alice,bob])db.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(hash(wallet),wallet,now-2000,now+60000);
  const save=(id:string,asker?:string,extra:Partial<QueryRun>={})=>{
    const run:QueryRun={id,createdAt:date,question:`SECRET question ${id}`,answer:`SECRET answer ${id}`,engine:"heuristic",budget:0.03,
      totalSpent:0.012345,totalToCreators:0.000001,subClaims:["SECRET claim"],decisions:[],citations:[],trace:[],...(asker?{asker}:{}),...extra};
    writeSqliteQueryRun(db,run,true);return run;
  };
  const historical=save("historical",alice);save("historical-unowned");
  db.exec(RUN_PRIVACY_SQL);
  const claims=createSqliteRunClaims(db), ownership=createSqliteRunOwnershipHistory(db), store=createSqliteRunPrivacy(db,ownership);
  const change=(id:string,visibility:RunVisibility,revision=0,who=actor())=>store.change(id,who,{visibility,revision,requestId:randomUUID()});
  return {db,store,save,change,claims,date,historical};
}
describe("#266 ordinary privacy and financial retention",()=>{
  it("exports exact financial amounts/states without journal rationale or custodian authorization bindings",()=>{
    const payment={id:"fixture",kind:"citation",sourceId:"fixture-source",sourceName:"Fixture",queryId:"owned",amountUsdc:0.000001,payer:alice,payee:bob,network:binding.network,
      settled:false,settlementStatus:"pending",txHash:null,createdAt:"2026-10-11T00:00:00.000Z",
      rationale:"PRIVATE question rationale",authorizationId:"PRIVATE nonce",authorizationPhase:"prepared",grantEpoch:"PRIVATE binding",authorizationExpiresAt:"2026-10-12T00:00:00.000Z"} as const;
    const stored=JSON.stringify(payment),projected=publicFinancialPayment(payment);
    expect(projected).toMatchObject({id:payment.id,queryId:payment.queryId,amountUsdc:payment.amountUsdc,payer:alice,payee:bob,network:binding.network,settled:false,settlementStatus:"pending",txHash:null});
    expect(JSON.stringify(projected)).not.toContain("PRIVATE");expect(projected.authorizationPhase).toBeUndefined();expect(projected.authorizationExpiresAt).toBeUndefined();expect(JSON.stringify(payment)).toBe(stored);
  });
  it("preserves canonical evidence presentation after visibility authorization and keeps owner exports original",async()=>{
    const f=fixture(),original=f.save("demo",alice,{citations:[{sourceId:"fixture-source",marker:"S1",sourceName:"Fixture",weight:1,reward:0.000001,rationale:"Synthetic"}]});
    let lookups=0;const projected=withRunReadProjection(f.store,run=>projectRecordedEvidenceProvenance(async()=>{lookups++;return new Set(["source:fixture-source"]);},run));
    expect((await projected.read(original.id)).item).toBeNull();expect(lookups).toBe(0);
    await f.change(original.id,"public");const read=(await projected.read(original.id)).item!.run;
    expect(read.answer).toContain(SYNTHETIC_EVIDENCE_NOTICE);expect(read.totalSpent).toBe(original.totalSpent);expect(read.totalToCreators).toBe(original.totalToCreators);
    expect((await projected.export(original.id,actor(),randomUUID())).run.answer).toBe(original.answer);
    expect(JSON.parse(String(f.db.prepare("SELECT data FROM query_runs WHERE id=?").get(original.id)?.data)).answer).toBe(original.answer);
  });
  it("preserves every historical link unlisted; captures authenticated private and anonymous unlisted defaults",async()=>{
    const f=fixture();f.save("owned",alice);f.save("anonymous");f.save("foreign",bob);
    for(const id of ["historical","historical-unowned","anonymous"])expect((await f.store.read(id)).item?.state.visibility).toBe("unlisted");
    expect((await f.store.read("owned")).item).toBeNull();expect((await f.store.read("owned",actor())).item?.run.question).toContain("SECRET");
    expect((await f.store.read("foreign",actor())).item).toBeNull();expect((await f.store.read("absent",actor())).item).toBeNull();
    expect(await f.store.list({take:50})).toEqual([]);expect(await f.store.defaults(actor())).toBe("private");
    f.save("historical",alice);expect((await f.store.read("historical")).item?.state.visibility).toBe("unlisted");
    const requestId=randomUUID();expect(await f.store.setDefault(actor(),"public",requestId)).toBe("public");
    expect(await f.store.setDefault(actor(),"public",requestId)).toBe("public");f.save("demo",alice);f.save("still-private",bob);f.save("still-unowned");
    expect((await f.store.list({take:1})).map(run=>run.id)).toEqual(["demo"]);
    await expect(f.store.setDefault(actor(),"private",requestId)).rejects.toMatchObject({code:"conflict"});
  });
  it("filters public bodies before pagination, parent enumeration and classified history; revocation has no stale text",async()=>{
    const f=fixture();for(const id of ["A","B","C","D"])f.save(id,alice,{parentId:"historical"});
    await f.change("A","public");await f.change("B","unlisted");await f.change("C","public");
    expect((await f.store.list({take:1})).map(run=>run.id)).toEqual(["C"]);
    expect((await f.store.list({take:2,parentId:"historical"})).map(run=>run.id)).toEqual(["C","A"]);
    expect((await f.store.list({take:2,before:{createdAt:f.date,id:"C"}})).map(run=>run.id)).toEqual(["A"]);
    expect((await f.store.list({take:1,ids:["D","B","A"]})).map(run=>run.id)).toEqual(["A"]);
    for(const id of ["A","B","C","D"])f.db.prepare("INSERT INTO query_memories VALUES(?,?,?,?,?)").run(id,"{}","[]",'["SECRET topic"]',f.date);
    expect((await f.store.memories(10)).map(row=>row.id)).toEqual(["C","A"]);
    expect(await listedQuestion({runPrivacy:f.store},"C")).toContain("SECRET");
    await f.change("C","private",1);expect(await listedQuestion({runPrivacy:f.store},"C")).toBeUndefined();
    expect((await f.store.memories(10)).map(row=>row.id)).toEqual(["A"]);
    const usage=createSqlitePublicUsage(f.db,()=>f.store), window={network:binding.network,since:"1970-01-01T00:00:00.000Z",until:new Date(Date.now()+60000).toISOString(),period:"all" as const};
    const summary=await usage.summary(window);await f.change("A","unlisted",1);
    expect(await usage.summary(window)).toEqual(summary);expect(await usage.history(window,"default",1)).toEqual([]);
  });
  it("denies cross-owner export/change/erase and atomically rechecks revoked and expired SIWE sessions",async()=>{
    const f=fixture();f.save("owned",alice);
    expect(await f.store.owner("owned",actor(bob))).toBeNull();
    await expect(f.store.export("owned",actor(bob),randomUUID())).rejects.toMatchObject({code:"not_found"});
    await expect(f.change("owned","public",0,actor(bob))).rejects.toMatchObject({code:"not_found"});
    await expect(f.store.erase("owned",actor(bob),{revision:0,requestId:randomUUID()})).rejects.toMatchObject({code:"not_found"});
    f.db.prepare("DELETE FROM web_sessions WHERE wallet=?").run(alice);
    await expect(f.change("owned","public")).rejects.toMatchObject({code:"unauthenticated"});
    f.db.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(hash(alice),alice,Date.now()-10000,Date.now()-1);
    await expect(f.store.setDefault(actor(),"public",randomUUID())).rejects.toMatchObject({code:"unauthenticated"});
    expect(f.db.prepare("SELECT count(*) n FROM run_privacy_audit").get()?.n).toBe(0);
  });
  it("filters intent metadata before retrieval and erases terminal demand text without changing rewards",async()=>{
    const f=fixture();f.save("visible",alice);f.save("hidden",alice);f.save("retry",alice);await f.change("visible","public");
    const insert=(id:string,failed:string,retry:string|null=null)=>f.db.prepare(`INSERT INTO gap_intents
      (id,gap_id,claim,question,failed_query_id,source_id,source_item_link,owner_wallet,status,retry_run_id,reward_usdc,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,id,"SECRET claim","SECRET question",failed,"source",`https://source.example/${id}`,bob,"filled",retry,0.000001,f.date,f.date);
    insert("public-offer","visible");insert("private-offer","hidden");insert("private-retry","visible","retry");
    const offers=await f.store.offers(10);expect(offers.map(row=>row.id)).toEqual(["public-offer"]);expect(JSON.stringify(offers)).not.toContain("SECRET");
    await f.change("retry","public");expect((await f.store.offers(10)).map(row=>row.id)).toEqual(["public-offer","private-retry"]);
    const rewards=f.db.prepare("SELECT id,reward_usdc FROM gap_intents ORDER BY id").all();
    await f.store.erase("visible",actor(),{revision:1,requestId:randomUUID()});expect(await f.store.offers(10)).toEqual([]);
    expect(f.db.prepare("SELECT question,claim FROM gap_intents WHERE failed_query_id='visible'").all().every(row=>row.question===""&&row.claim==="")).toBe(true);
    expect(f.db.prepare("SELECT id,reward_usdc FROM gap_intents ORDER BY id").all()).toEqual(rewards);
  });
  it("exports the exact original, erases derived indexes idempotently, preserves financial objects and prevents resurrection",async()=>{
    const f=fixture(),run=f.save("owned",alice);
    f.db.prepare("INSERT INTO payment_events(id,created_at,kind,query_id,source_id,source_name,payer,payee,amount_usdc,network,settled,rationale) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("synthetic-payment",f.date,"citation",run.id,"source","Public creator",alice,bob,0.000001,binding.network,0,"Retained financial rationale SECRET");
    f.db.prepare("INSERT INTO query_memories VALUES(?,?,?,?,?)").run(run.id,"{}","[]",'["SECRET"]',f.date);
    const finances=f.db.prepare("SELECT * FROM payment_events").all(), totals=f.db.prepare("SELECT id,budget,total_spent,total_to_creators FROM query_runs WHERE id=?").get(run.id);
    const exported=await f.store.export(run.id,actor(),randomUUID());expect(exported.run).toMatchObject(run);
    const requestId=randomUUID(), input={revision:0,requestId};const erased=await f.store.erase(run.id,actor(),input);
    expect(await f.store.erase(run.id,actor(),input)).toEqual(erased);
    expect(await f.store.erase(run.id,actor(),{revision:0,requestId:randomUUID()})).toEqual(erased);
    expect((await f.store.read(run.id,actor())).item).toBeNull();expect(await f.store.list({take:50})).toEqual([]);
    expect(JSON.stringify(f.db.prepare("SELECT data,question,answer FROM query_runs WHERE id=?").get(run.id))).not.toContain("SECRET");
    expect(f.db.prepare("SELECT * FROM query_memories WHERE id=?").all(run.id)).toEqual([]);
    expect(f.db.prepare("SELECT * FROM payment_events").all()).toEqual(finances);
    expect(f.db.prepare("SELECT id,budget,total_spent,total_to_creators FROM query_runs WHERE id=?").get(run.id)).toEqual(totals);
    const proof=settlementReceipt((await f.store.settlement(run.id))!,finances.map(value=>({queryId:String(value.query_id),amountUsdc:Number(value.amount_usdc),rationale:String(value.rationale)} as never)));
    expect(JSON.stringify(proof)).not.toContain("SECRET");expect(proof.recordedSpendUsdc).toBe(run.totalSpent);
    expect((await f.store.export(run.id,actor(),randomUUID())).run.answer).toBe("");
    expect(()=>f.save(run.id,alice)).toThrow(/privacy_erased/);
    expect(()=>f.db.prepare("INSERT INTO query_memories VALUES(?,?,?,?,?)").run(run.id,"{}","[]",'["SECRET"]',f.date)).toThrow(/privacy_erased/);
    expect(()=>f.db.exec("DELETE FROM run_privacy_audit")).toThrow(/privacy_retained/);
    expect(JSON.stringify(f.db.prepare("SELECT * FROM run_privacy_audit").all())).not.toContain("SECRET");
  });
  it("reuses an admitted immutable claim without assigning a payer, and retains its owner proof after erasure",async()=>{
    const f=fixture();f.save("claimed");await f.claims.issue({runId:"claimed",completedAt:f.date,tokenHash:hash("claim"),binding});
    await f.claims.claim({tokenHash:hash("claim"),wallet:alice,sessionHash:hash(alice),binding});
    const financialOwner=f.db.prepare("SELECT asker FROM query_runs WHERE id='claimed'").get()?.asker;expect(financialOwner).toBeNull();
    await f.change("claimed","private");expect((await f.store.read("claimed",actor())).item?.run.asker).toBeUndefined();
    await f.store.erase("claimed",actor(),{revision:1,requestId:randomUUID()});
    expect((await f.store.owner("claimed",actor()))?.state.erased).toBe(true);expect(await f.store.owner("claimed",actor(bob))).toBeNull();
    expect(await f.store.owner("claimed",{...actor(),binding:{...binding,origin:"https://other.example"}})).toBeNull();
    expect(f.db.prepare("SELECT asker FROM query_runs WHERE id='claimed'").get()?.asker).toBeNull();
  });
  it("fails closed on missing/drifted/enrolled domains and names protected-original erasure holds",async()=>{
    const f=fixture();f.save("protected",alice,{originalFulfillment:{version:1} as never});
    await expect(f.store.erase("protected",actor(),{revision:0,requestId:randomUUID()})).rejects.toMatchObject({code:"retention_hold"});
    f.db.exec("DROP TRIGGER run_privacy_no_resurrection_update");await expect(f.store.read("historical")).rejects.toBeInstanceOf(PrivacyError);
    const absent=new DatabaseSync(":memory:");connections.push(absent);installSqliteApplicationSchema(absent);expect(()=>createSqliteRunPrivacy(absent)).toThrow();
    const drift=fixture();drift.db.exec("ALTER TABLE web_sessions ADD COLUMN unexpected TEXT");await expect(drift.store.read("historical")).rejects.toThrow();
    const enrolled=fixture();enrolled.db.exec("CREATE TABLE keryx_storage_identity(unexpected TEXT)");await expect(enrolled.store.read("historical")).rejects.toThrow();
  });
});
