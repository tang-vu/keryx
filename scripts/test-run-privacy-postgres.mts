/** Explicit network-none synthetic PG17 acceptance. No ambient database/credentials/provider use. */
import {execFileSync} from "node:child_process";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import assert from "node:assert/strict";
assert.deepEqual(process.argv.slice(2),["--acceptance"],"Explicit isolated acceptance required");
const name=`keryx-run-privacy-${randomUUID()}`,label="keryx.run-privacy.fixture",wallet=`0x${"a".repeat(40)}`,other=`0x${"b".repeat(40)}`,session="a".repeat(64);
const docker=(args:string[],input?:string)=>execFileSync("docker",args,{input,encoding:"utf8",timeout:30000,maxBuffer:2*1024*1024,windowsHide:true});
const sql=(input:string)=>docker(["exec","-i",name,"psql","-X","-h","127.0.0.1","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-qAt"],input).trim();
const literal=(value:unknown)=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const now=Date.now(),date=new Date(now-1000).toISOString(), actor={wallet,sessionHash:session,binding:{network:"eip155:5042002",origin:"https://synthetic-privacy.example"}};
const call=(action:string,id:string|null,input:unknown={},who:unknown=actor,claims=false,role="service_role")=>JSON.parse(sql(`set role ${role};select public.run_privacy_v1('${action}',${id?`'${id}'`:"null"},${literal(input)},${who?literal(who):"null"},${claims});`).split("\n").at(-1)!).result;
const run=(id:string,asker:string|null=wallet)=>({id,createdAt:date,question:`SECRET ${id}`,answer:"SECRET answer",budget:0.1,engine:"fixture",totalSpent:0.012345,totalToCreators:0.000001,subClaims:[],decisions:[],citations:[],trace:[],...(asker?{asker}:{})});
const save=(id:string,asker:string|null=wallet)=>sql(`insert into query_runs(id,created_at,asker,question,answer,budget,engine,total_spent,total_to_creators,data)values('${id}','${date}',${asker?`'${asker}'`:"null"},'SECRET','SECRET',0.1,'fixture',0.012345,0.000001,${literal(run(id,asker))});`);
let created=false;
try {
  docker(["run","-d","--name",name,"--label",`${label}=${name}`,"--network","none","--memory","512m","--cpus","1","-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:17-alpine"]);created=true;
  for(let attempt=0;;attempt++){try{sql("select 1;");break;}catch(error){if(attempt>=30)throw error;await new Promise(done=>setTimeout(done,200));}}
  sql(`create role anon;create role authenticated;create role service_role bypassrls;
    create table query_runs(id text primary key,created_at timestamptz not null,asker text,question text,answer text,budget numeric,engine text,total_spent numeric,total_to_creators numeric,parent_id text,data jsonb not null);
    create table web_sessions(hash text primary key check(hash ~ '^[a-f0-9]{64}$'),wallet text not null check(wallet ~ '^0x[a-f0-9]{40}$'),issued_at bigint not null check(issued_at>=0),expires_at bigint not null check(expires_at>issued_at and expires_at<=issued_at+604800000));
    create table a2a_orders(query_id text not null unique);
    create table query_memories(id text primary key,created_at timestamptz,source_scores jsonb,topics jsonb,sources_read jsonb);
    create table gap_intents(id text primary key,gap_id text,source_id text,source_item_link text,item_id text,content_version text,article_offer_id text,owner_wallet text,status text,attempts integer,retry_run_id text,coverage numeric,reward_usdc numeric,created_at timestamptz,updated_at timestamptz,failed_query_id text,question text,claim text,last_error text);
    create table payment_events(id text primary key,query_id text,amount_usdc numeric,rationale text,payer text,payee text,settled boolean,network text);
    alter table query_runs enable row level security;create policy query_service on query_runs to service_role using(true) with check(true);create policy query_legacy_public on query_runs for select using(true);
    grant all on query_runs,web_sessions,a2a_orders,query_memories,gap_intents,payment_events to service_role;
    grant select on query_runs,query_memories,gap_intents,payment_events to anon,authenticated;
    grant select(data) on query_runs to anon;
    insert into web_sessions values('${session}','${wallet}',${now-2000},${now+600000});`);
  save("historical");save("unowned",null);
  sql(readFileSync(resolve("supabase/migrations/0088_anonymous_run_claims.sql"),"utf8"));
  // Existing admitted proof, before the ACL delta. No owner is written into the original.
  save("claimed",null);
  sql(`set role service_role;select anonymous_run_claim_issue_v1('claimed','${"c".repeat(64)}','${date}','${actor.binding.network}','${actor.binding.origin}');
    select anonymous_run_claim_consume_v1('${"c".repeat(64)}','${wallet}','${session}','${actor.binding.network}','${actor.binding.origin}');`);
  const originalClaim=sql("select md5(string_agg(row_to_json(c)::text,'' order by run_id)) from anonymous_run_claims c;");
  sql(readFileSync(resolve("supabase/migrations/0090_run_privacy.sql"),"utf8"));
  sql("set role service_role;select anonymous_run_claims_guard_v1();");
  assert.equal(sql("select md5(string_agg(row_to_json(c)::text,'' order by run_id)) from anonymous_run_claims c;"),originalClaim);
  assert.equal(call("owner","claimed",{},actor,true).run.asker,undefined);
  assert.equal(call("owner","claimed",{},{...actor,wallet:other},true),null);
  assert.equal(call("owner","claimed",{},{...actor,binding:{...actor.binding,origin:"https://other.example"}},true),null);
  assert.equal(call("visibility","claimed",{revision:0,visibility:"private",requestId:randomUUID()},actor,true).visibility,"private");
  assert.equal(call("read","claimed",{},null,true).item,null);
  call("erase","claimed",{revision:1,requestId:randomUUID()},actor,true);
  assert.equal(call("owner","claimed",{},actor,true).state.erased,true);
  assert.equal(sql("select asker is null from query_runs where id='claimed';"),"t");
  assert.equal(sql("select md5(string_agg(row_to_json(c)::text,'' order by run_id)) from anonymous_run_claims c;"),originalClaim);
  assert.equal(call("read","historical",{},null).item.state.visibility,"unlisted");assert.equal(call("read","unowned",{},null).item.state.visibility,"unlisted");
  save("owned");save("anonymous",null);save("foreign",other);
  assert.equal(call("read","owned",{},null).item,null);assert.equal(call("read","owned",{},actor).item.run.answer,"SECRET answer");
  assert.equal(call("read","owned",{},{...actor,wallet:other}).item,null);assert.equal(call("owner","owned",{},{...actor,wallet:other}),null);
  assert.throws(()=>call("erase","owned",{revision:0,requestId:randomUUID()},{...actor,wallet:other}));
  assert.deepEqual(call("list",null,{take:50},null),[]);
  const mutation={revision:0,visibility:"public",requestId:randomUUID()};assert.equal(call("visibility","owned",mutation).visibility,"public");assert.deepEqual(call("visibility","owned",mutation),call("visibility","owned",mutation));
  assert.equal(call("list",null,{take:1},null)[0].run.id,"owned");
  const publicFinancials=call("settlement","owned",{},null);
  assert.throws(()=>call("visibility","owned",{...mutation,visibility:"unlisted"}));
  const defaultId=randomUUID();assert.equal(call("default",null,{visibility:"public",requestId:defaultId}),"public");save("demo");assert.equal(call("read","demo",{},null).item.state.visibility,"public");
  assert.equal(call("default",null,{visibility:"private",requestId:randomUUID()}),"private");save("private-default");assert.equal(call("read","private-default",{},null).item,null);
  call("visibility","demo",{revision:0,visibility:"private",requestId:randomUUID()});assert.equal(call("read","demo",{},null).item,null);
  assert.equal(call("list",null,{take:50},null).some((item:{run:{id:string}})=>item.run.id==="demo"),false);
  assert.deepEqual(call("settlement","owned",{},null),publicFinancials);
  sql(`insert into payment_events values('fixture','owned',0.000001,'SECRET financial rationale','${wallet}','${other}',false,'eip155:5042002');insert into query_memories values('owned','${date}','{}','["SECRET"]','[]');`);
  const finances=sql("select md5(string_agg(row_to_json(p)::text,'' order by id)) from payment_events p;"),totals=call("settlement","owned",{},null);
  const exported=call("export","owned",{requestId:randomUUID()});assert.deepEqual(exported.run,run("owned"));
  const erasure={revision:1,requestId:randomUUID()},erased=call("erase","owned",erasure);assert.equal(erased.erased,true);assert.deepEqual(call("erase","owned",erasure),erased);
  assert.equal(call("read","owned",{},actor).item,null);assert.deepEqual(call("settlement","owned",{},null),totals);
  assert.equal(sql("select md5(string_agg(row_to_json(p)::text,'' order by id)) from payment_events p;"),finances);
  assert.equal(sql("select data::text from query_runs where id='owned';").includes("SECRET"),false);assert.equal(sql("select count(*) from query_memories where id='owned';"),"0");
  assert.throws(()=>sql("update query_runs set question='SECRET' where id='owned';"));
  assert.throws(()=>call("export","owned",{requestId:randomUUID()},{...actor,wallet:other}));
  for(const role of ["anon","authenticated"])for(const table of ["query_runs","query_memories","gap_intents","payment_events"]){assert.throws(()=>sql(`set role ${role};select * from ${table};`));assert.throws(()=>call("read","owned",{},actor,false,role));}
  sql(`delete from web_sessions where hash='${session}';`);assert.throws(()=>call("visibility","demo",{revision:1,visibility:"public",requestId:randomUUID()}));
  sql("alter table run_privacy add column unexpected text;");assert.throws(()=>call("read","historical",{},null));
  console.log("#266 PostgreSQL: defaults, all visibility levels, owner/export/erase/retry/revocation, legacy ACL closure, existing claim admission and exact financial equality passed. Synthetic only.");
} finally {
  if(created){const observed=docker(["inspect","--format",`{{ index .Config.Labels "${label}" }}`,name]);assert.equal(observed,name,"Refuse non-owned fixture cleanup");docker(["rm","-f",name]);}
}
