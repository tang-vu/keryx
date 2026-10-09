/** Actual0080+0082 SQL, isolated disposable PostgreSQL. Synthetic observations only. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { operatorInventorySchema,operatorPublicSnapshotSchema } from "../lib/business-operator/contracts.ts";
import { summarizeA2aOperations } from "../lib/a2a/operations.ts";
import { completionFixtureRows, ordinaryCompletion, recoveredCompletion, COMPLETION_FIXTURE_NOW } from "../lib/a2a/completion-latency.test-support.ts";
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
      started_at timestamptz,transaction_id text,created_at timestamptz,updated_at timestamptz,
      execution_journal_version integer,package_data jsonb,response_data jsonb,resolution_data jsonb);
    create table public.research_monthly(id text,data jsonb);
    create table public.research_monthly_redemptions(monthly_id text);
    grant select on public.sources,public.a2a_orders,public.research_monthly,public.research_monthly_redemptions to service_role;`);
  sql(readFileSync("supabase/migrations/0080_operator_inventory.sql","utf8"));
  const payee="0x2222222222222222222222222222222222222222",now="2026-10-06T00:00:00.000Z";
  sql(`insert into sources select i::text,true from generate_series(1,1201) i;
    insert into a2a_orders(status,payee,request_data,creator_budget_usdc,started_at,transaction_id,created_at,updated_at)
      select 'running','${payee}','{"network":"eip155:5042"}',0.0314,null,'original','${now}','${now}' from generate_series(1,1201);
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
  sql(`insert into a2a_orders(status,payee,request_data,creator_budget_usdc,started_at,transaction_id,created_at,updated_at)
    values('completed','${payee}','{}',0.05,null,'original','2026-10-05T23:59:59Z','${now}');`);
  const finished=operatorPublicSnapshotSchema.parse(JSON.parse(sql(`set role service_role;select operator_public_snapshot_v1('${now}');`)));
  assert.equal(finished.jobs?.completionLatencyP50Ms,1000);assert.equal(finished.jobs?.completionRateLast24h,1);
  assert.equal(finished.jobs?.completionLatencyCohorts,null); // Old SQL capability stays unknown.
  for(const role of ["anon","authenticated"])for(const signature of ["public.operator_inventory_v1(text,text,timestamp with time zone)","public.operator_public_snapshot_v1(timestamp with time zone)"])
    assert.equal(sql(`select has_function_privilege('${role}','${signature}','EXECUTE');`),"f");
  sql(`update research_monthly set data=jsonb_set(data,'{network}','"eip155:5042002"');`);assert.equal(observe().invalidJobs,1);
  sql(readFileSync("supabase/migrations/0082_operator_completion_cohorts.sql","utf8"));
  const quoted=(value:unknown)=>`'${JSON.stringify(value ?? null).replace(/'/g,"''")}'::jsonb`;
  const instant=(value:string|null)=>value===null?"null":`'${value}'::timestamptz`;
  const rows=completionFixtureRows(),cohortNow=new Date(COMPLETION_FIXTURE_NOW).toISOString();
  for(const row of rows)sql(`insert into a2a_orders(status,payee,request_data,creator_budget_usdc,started_at,transaction_id,
    created_at,updated_at,execution_journal_version,package_data,response_data,resolution_data)
    values('${row.status}','${payee}','{}',0.05,${instant(row.startedAt)},'synthetic no settlement',${instant(row.createdAt)},${instant(row.updatedAt)},
    ${row.executionJournalVersion===1?1:"null"},${quoted(row.researchPackage)},${quoted({serviceReceipt:row.serviceReceipt})},${quoted(row.resolution)});`);
  const withCohorts=operatorPublicSnapshotSchema.parse(JSON.parse(sql(`set role service_role;select operator_public_snapshot_v1('${cohortNow}');`)));
  const expected=summarizeA2aOperations(rows,COMPLETION_FIXTURE_NOW,true);
  assert.equal(withCohorts.jobs?.queued,1201);assert.equal(withCohorts.creatorCatalog.registered,1201);
  assert.equal(withCohorts.jobs?.completedLast24h,6); // Earlier old-SQL fixture is outside this new window.
  assert.deepEqual(withCohorts.jobs?.completionLatencyCohorts,expected.completionLatencyCohorts);
  assert.equal(withCohorts.jobs?.completionLatencyP95Ms,52*60*60_000);
  // Later bookkeeping updates the report endpoint, not the original receipt finish.
  const laterUpdate=new Date(COMPLETION_FIXTURE_NOW+30_000).toISOString();
  sql(`update a2a_orders set updated_at='${laterUpdate}' where status='completed'
    and created_at='${new Date(COMPLETION_FIXTURE_NOW-1000).toISOString()}';`);
  const afterBookkeeping=operatorPublicSnapshotSchema.parse(JSON.parse(sql(`set role service_role;
    select operator_public_snapshot_v1('${laterUpdate}');`)));
  assert.deepEqual(afterBookkeeping.jobs?.completionLatencyCohorts?.ordinary,
    {completed:2,timedSamples:2,p50Ms:3000,p95Ms:31_000});
  for(const mutation of [
    {...ordinaryCompletion(1000),resolution:{...(recoveredCompletion(1000).resolution as object),actor:null}},
    {...ordinaryCompletion(1000),serviceReceipt:{...(ordinaryCompletion(1000).serviceReceipt as object),finishedAt:"2026-02-30T00:00:00.000Z"}},
    {...ordinaryCompletion(1000),resolution:{...(recoveredCompletion(1000,true).resolution as object),fulfillment:{claimId:123}}},
  ])assert.equal(sql(`set role service_role;select operator_recorded_completion_cohort_v1(${quoted(mutation.resolution)},
    ${quoted(mutation.serviceReceipt)},${quoted(mutation.researchPackage)},1,${instant(mutation.createdAt)},${instant(mutation.startedAt)},${instant(mutation.updatedAt)});`),"unknown");
  for(const role of ["anon","authenticated"])assert.equal(sql(`select has_function_privilege('${role}',
    'public.operator_recorded_completion_cohort_v1(jsonb,jsonb,jsonb,integer,timestamp with time zone,timestamp with time zone,timestamp with time zone)','EXECUTE');`),"f");
  assert.doesNotMatch(JSON.stringify(withCohorts),/claimId|providerLedger|resolution_data|serviceReceipt/);
  console.log("Operator PostgreSQL acceptance passed:1201 whole orders/sources,Monthly reserve,legacy capability,ordinary/52h repair/fulfillment/unknown cohorts,TS parity,malformed refusal,private ACLs.");
}finally{if(created)docker(["rm","-f",name]);}
