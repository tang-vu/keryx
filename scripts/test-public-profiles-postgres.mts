/** Explicit isolated PG17 SOURCE acceptance. Existing Docker fixture pattern; no ambient DB/credentials or downloads. */
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
assert.deepEqual(process.argv.slice(2),["--acceptance"],"Explicit isolated acceptance required");
const name=`keryx-public-profile-${randomUUID()}`,label="keryx.public-profile.fixture";
const docker=(args:string[],input?:string)=>execFileSync("docker",args,{input,encoding:"utf8",timeout:30000,maxBuffer:2*1024*1024,windowsHide:true});
const args=["exec","-i",name,"psql","-X","-h","127.0.0.1","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-qAt"];
const sql=(text:string)=>docker(args,text).trim();
const literal=(value:unknown)=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const wallet=(tag:string)=>`0x${tag.repeat(40)}`,session=(tag:string)=>tag.repeat(64);
const binding={network:"eip155:5042002",origin:"https://synthetic-public-profile.example"};
const actor=(tag:string)=>({wallet:wallet(tag),sessionHash:session(tag),binding});
const statement=(action:string,tag:string,input:unknown={})=>`set role service_role;select public.public_researcher_profile_v1('${action}',null,${literal(actor(tag))},${literal(input)},false);`;
const call=(action:string,tag:string,input:unknown={})=>JSON.parse(sql(statement(action,tag,input)).split("\n").at(-1)!).result;
const publish=(tag:string,revision=0)=>statement("update",tag,{published:true,fields:["about","purpose"],runIds:[`private_${tag}`],revision});
const asyncExec=promisify(execFile),asyncSql=(text:string)=>asyncExec("docker",[...args,"-c",text],{timeout:30000,maxBuffer:2*1024*1024,windowsHide:true});
const waitUntil=async(condition:()=>boolean,message:string)=>{const deadline=Date.now()+10000;while(!condition()){if(Date.now()>deadline)throw Error(message);await new Promise(done=>setTimeout(done,25));}};
const waitBlocked=(application:string)=>waitUntil(()=>sql(`select count(*) from pg_stat_activity where application_name='${application}' and wait_event_type='Lock';`)==="1","Actual lock barrier not reached");
const held=new Set<ChildProcessWithoutNullStreams>();
const hold=async(text:string)=>{
  const child=spawn("docker",args,{stdio:["pipe","pipe","pipe"],timeout:30000,windowsHide:true});held.add(child);
  let output="",errors="";child.stdout.setEncoding("utf8").on("data",v=>{output+=v;});child.stderr.setEncoding("utf8").on("data",v=>{errors+=v;});
  const exit=new Promise<void>((done,reject)=>{child.on("error",reject);child.on("close",code=>{held.delete(child);if(code===0)done();else reject(Error(errors||"Owned SQL barrier failed"));});});void exit.catch(()=>{});
  child.stdin.write(`begin;${text};select 'HELD';\n`);await waitUntil(()=>output.includes("HELD"),"Owned SQL lock not acquired");
  return async()=>{child.stdin.end("commit;\n\\q\n");await exit;};
};
let created=false;
try {
  docker(["run","-d","--pull=never","--name",name,"--label",`${label}=${name}`,"--network","none","--memory","512m","--cpus","1","-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:17-alpine"]);created=true;
  await waitUntil(()=>{try{return sql("select 1;")==="1";}catch{return false;}},"Owned PG17 unavailable");
  sql(`create role anon;create role authenticated;create role service_role bypassrls;
    create table users(wallet_address text primary key,first_seen_at timestamptz);
    create table query_runs(id text primary key,created_at timestamptz not null,asker text,origin text,question text,answer text,budget numeric,engine text,total_spent numeric,total_to_creators numeric,parent_id text,data jsonb not null);
    create table web_sessions(hash text primary key check(hash ~ '^[a-f0-9]{64}$'),wallet text not null check(wallet ~ '^0x[a-f0-9]{40}$'),issued_at bigint not null check(issued_at>=0),expires_at bigint not null check(expires_at>issued_at and expires_at<=issued_at+604800000));
    create table a2a_orders(query_id text not null unique,status text not null,created_at timestamptz not null,started_at timestamptz,amount_usdc double precision not null,creator_budget_usdc double precision not null,service_fee_usdc double precision not null,transaction_id text not null,request_data jsonb,response_data jsonb,authorization_id text);
    create table query_memories(id text primary key,created_at timestamptz,source_scores jsonb,topics jsonb,sources_read jsonb);
    create table gap_intents(id text primary key,gap_id text,source_id text,source_item_link text,item_id text,content_version text,article_offer_id text,owner_wallet text,status text,attempts integer,retry_run_id text,coverage numeric,reward_usdc numeric,created_at timestamptz,updated_at timestamptz,failed_query_id text,question text,claim text,last_error text);
    create table payment_events(id text primary key,query_id text,amount_usdc numeric,rationale text,payer text,payee text,kind text,settled boolean,settlement_status text,tx_hash text,network text);
    alter table query_runs enable row level security;create policy query_service on query_runs to service_role using(true) with check(true);create policy query_public on query_runs for select using(true);
    grant all on users,query_runs,web_sessions,a2a_orders,query_memories,gap_intents,payment_events to service_role;
    grant select on query_runs,query_memories,gap_intents,payment_events to anon,authenticated;`);
  for(const file of ["0083_private_profiles.sql","0085_profile_verified_identities.sql","0088_anonymous_run_claims.sql","0090_run_privacy.sql","0091_public_researcher_profiles.sql"])
    sql(readFileSync(`supabase/migrations/${file}`,"utf8"));
  const stamp=()=>Number(sql("select floor(extract(epoch from clock_timestamp())*1000)::bigint;"));
  const seed=(tag:string,life=60000)=>{
    const now=stamp(),date=new Date(now-100).toISOString(),run={id:`private_${tag}`,createdAt:date,asker:wallet(tag),question:"PRIVATE selected question",answer:"PRIVATE answer",budget:0,engine:"fixture",totalSpent:0,totalToCreators:0,subClaims:[],decisions:[],citations:[],trace:[],paymentMode:"offline"};
    sql(`set role service_role;select private_profile_update_v1('${wallet(tag)}',${literal({handle:`owner_${tag}`,displayName:"Owner",bio:"PRIVATE about",purpose:"PRIVATE purpose",links:[]})});
      insert into web_sessions values('${session(tag)}','${wallet(tag)}',${now-1000},${now+life});
      insert into query_runs(id,created_at,asker,question,answer,budget,engine,total_spent,total_to_creators,data)values('private_${tag}','${date}','${wallet(tag)}','PRIVATE','PRIVATE',0,'fixture',0,0,${literal(run)});`);
    return now+life;
  };
  // Existing admitted unpublish transaction holds its owner lock; stale first PUT
  // really waits, then resumes only AFTER DELETE has committed its durable fence.
  seed("a");const releaseDelete=await hold(statement("unpublish","a"));
  const stale=asyncSql(`set application_name='profile264_stale';${publish("a")}`);void stale.catch(()=>{});
  await waitBlocked("profile264_stale");await releaseDelete();await assert.rejects(stale,/conflict/);
  assert.equal(call("settings","a").revision,1);assert.equal(call("settings","a").published,false);
  assert.equal(sql(`set role service_role;select (public_researcher_profile_v1('read','owner_a',null,'{}',false)->'result') is null or public_researcher_profile_v1('read','owner_a',null,'{}',false)->'result'='null'::jsonb;`),"t");
  assert.deepEqual(JSON.parse(sql(`set role service_role;select public_researcher_profile_v1('sitemap',null,null,'{"take":1000}',false);`)).result,[]);
  // Fresh separate psql connections retain the revision; a deliberate new consent
  // succeeds, but selected PRIVATE research remains absent from the public packet.
  call("update","a",{published:true,fields:["about"],runIds:["private_a"],revision:1});
  const read=JSON.parse(sql(`set role service_role;select public_researcher_profile_v1('read','owner_a',null,'{}',false);`)).result;
  assert.equal(read.profile.about,"PRIVATE about");assert.deepEqual(read.runs,[]);call("unpublish","a");
  // Revoke that wins the session lock commits before the publisher obtains SHARE.
  seed("b");const releaseRevoke=await hold(`delete from web_sessions where hash='${session("b")}'`);
  const revoked=asyncSql(`set application_name='profile264_revoked';${publish("b")}`);void revoked.catch(()=>{});
  await waitBlocked("profile264_revoked");await releaseRevoke();await assert.rejects(revoked,/unauthenticated/);
  assert.equal(sql(`select count(*) from public_researcher_profiles where wallet='${wallet("b")}'`),"0");
  // Expiry during a query_runs FOR UPDATE wait is rejected by the FINAL clock
  // check. A queued revoke cannot acknowledge while the publication holds SHARE.
  seed("c");const releaseOriginal=await hold("select 1 from query_runs where id='private_c' for update");
  // Shorten only this synthetic newly seeded session before publication; no runtime/backend setting.
  sql(`update web_sessions set expires_at=floor(extract(epoch from clock_timestamp())*1000)::bigint+1500 where hash='${session("c")}';`);
  const expired=asyncSql(`set application_name='profile264_expired';${publish("c")}`);void expired.catch(()=>{});
  await waitBlocked("profile264_expired");
  const revoke=asyncSql(`set application_name='profile264_queued_revoke';delete from web_sessions where hash='${session("c")}';`);void revoke.catch(()=>{});
  await waitBlocked("profile264_queued_revoke");
  await waitUntil(()=>sql(`select expires_at<=floor(extract(epoch from clock_timestamp())*1000)::bigint from web_sessions where hash='${session("c")}';`)==="t","Synthetic DB expiry did not occur");
  await releaseOriginal();await assert.rejects(expired,/unauthenticated/);await revoke;
  assert.equal(sql(`select count(*) from public_researcher_profiles where wallet='${wallet("c")}'`),"0");
  assert.equal(sql("select count(*) from query_runs q join run_privacy p on p.run_id=q.id where p.visibility='private' and not p.erased;"),"3");
  for(const role of ["anon","authenticated"])assert.throws(()=>sql(`set role ${role};select public_researcher_profile_v1('read','owner_a',null,'{}',false);`));
  console.log("#264 isolated PG17: first DELETE/stale PUT lock barrier, persisted CAS, selected PRIVATE exclusion, revoke ordering and expiry after ownership wait accepted. No external DB, model, payment or activation.");
} finally {
  for(const child of held)child.stdin.end("rollback;\n\\q\n");
  if(created){assert.equal(docker(["inspect","--format",`{{ index .Config.Labels "${label}" }}`,name]).trim(),name,"Refuse non-owned fixture cleanup");docker(["rm","-f",name]);}
}
