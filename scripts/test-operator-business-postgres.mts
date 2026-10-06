/** Actual0080 SQL, isolated disposable PostgreSQL. Synthetic observations only. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { operatorInventorySchema,operatorPublicSnapshotSchema } from "../lib/business-operator/contracts.ts";
const name=`keryx-operator-${randomUUID()}`;
const docker=(args:string[],input?:string)=>execFileSync("docker",args,{input,encoding:"utf8",timeout:30000,maxBuffer:8*1024*1024,stdio:["pipe","pipe","pipe"]});
const sql=(statement:string)=>docker(["exec","-i",name,"psql","-h","127.0.0.1","-U","postgres","-qAt","-v","ON_ERROR_STOP=1"],statement).trim();
let created=false;
try {
  docker(["info","--format","{{.ServerVersion}}"]); created=true;
  docker(["run","-d","--name",name,"--network","none","--memory","512m","--cpus","1","-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:17-alpine"]);
  const deadline=Date.now()+30000;
  while(true) { try { assert.equal(sql("select 1;"),"1");break; } catch(cause) {
    if(Date.now()>deadline)throw new Error("Owned PostgreSQL startup unavailable",{cause});
    await new Promise(resolve=>setTimeout(resolve,100));
  } }
  sql(`create role anon;create role authenticated;create role service_role;
    create table public.sources(id text,active boolean);
    create table public.a2a_orders(status text,payee text,request_data jsonb,creator_budget_usdc numeric,
      started_at timestamptz,transaction_id text,created_at timestamptz,updated_at timestamptz);
    create table public.research_monthly(id text,data jsonb);
    create table public.research_monthly_redemptions(monthly_id text);
    grant select on public.sources,public.a2a_orders,public.research_monthly,public.research_monthly_redemptions to service_role;`);
  sql(readFileSync("supabase/migrations/0080_operator_inventory.sql","utf8"));
  const payee="0x2222222222222222222222222222222222222222",now="2026-10-06T00:00:00.000Z";
  sql(`insert into sources select i::text,true from generate_series(1,1201) i;
    insert into a2a_orders select 'running','${payee}','{"network":"eip155:5042"}',0.0314,null,'original','${now}','${now}' from generate_series(1,1201);
    insert into research_monthly values('original','{"network":"eip155:5042","payee":"${payee}","creatorBudgetMicros":50000.0,
      "createdAt":"2026-10-05T00:00:00.000Z","expiresAt":"2026-11-05T00:00:00.000Z","transaction":"original-inbound"}');
    insert into research_monthly_redemptions values('original');`);
  const observe=()=>operatorInventorySchema.parse(JSON.parse(sql(`set role service_role;
    select operator_inventory_v1('eip155:5042','${payee}','${now}');`)));
  assert.deepEqual({...observe(),observedAt:undefined},{observedAt:undefined,network:"eip155:5042",queuedJobs:1201,
    processingJobs:0,reviewRequiredJobs:0,invalidJobs:0,queuedCreatorMicroUsdc:"37711400",unfinishedCreatorMicroUsdc:"0",
    prepaidRequests:3,prepaidCreatorMicroUsdc:"150000",largestCreatorMicroUsdc:"50000"});
  const snapshot=operatorPublicSnapshotSchema.parse(JSON.parse(sql(`set role service_role;select operator_public_snapshot_v1('${now}');`)));
  assert.equal(snapshot.jobs?.queued,1201);assert.equal(snapshot.jobs?.completedLast24h,0);assert.equal(snapshot.jobs?.completionRateLast24h,null);
  assert.equal(snapshot.creatorCatalog.registered,1201);
  sql(`insert into a2a_orders values('completed','${payee}','{}',0.05,null,'original','2026-10-05T23:59:59Z','${now}');`);
  const finished=operatorPublicSnapshotSchema.parse(JSON.parse(sql(`set role service_role;select operator_public_snapshot_v1('${now}');`)));
  assert.equal(finished.jobs?.completionLatencyP50Ms,1000);assert.equal(finished.jobs?.completionRateLast24h,1);
  for(const role of ["anon","authenticated"])for(const signature of ["public.operator_inventory_v1(text,text,timestamp with time zone)","public.operator_public_snapshot_v1(timestamp with time zone)"])
    assert.equal(sql(`select has_function_privilege('${role}','${signature}','EXECUTE');`),"f");
  sql(`update research_monthly set data=jsonb_set(data,'{network}','"eip155:5042002"');`);assert.equal(observe().invalidJobs,1);
  console.log("Operator PostgreSQL acceptance passed:1201 originals,1201 sources,Monthly reserve/canonical .0,percentiles,private ACLs.");
}finally{if(created)docker(["rm","-f",name]);}
