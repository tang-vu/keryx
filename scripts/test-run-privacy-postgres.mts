/** Explicit network-none synthetic PG17 acceptance. No ambient database/credentials/provider use. */
import {execFile,execFileSync} from "node:child_process";
import {promisify} from "node:util";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabasePersonalHistory } from "../lib/db/personal-history-supabase";
import { createSupabaseRunOwnershipHistory } from "../lib/db/run-ownership-history-supabase";
import { createSupabaseRunPrivacy } from "../lib/db/run-privacy-supabase";
import { createSupabaseResearchPublication } from "../lib/db/research-publication-supabase";
import { exportOwnedHistory } from "../lib/history/owned-history-export";
import { readOwnedDetail, readOwnedHistory, type OwnedHistoryDB } from "../lib/history/owned-history-reader";
import type { RunClaimBinding } from "../lib/run-claims/contracts";
const args=process.argv.slice(2);
assert(args[0]==="--acceptance" && (args.length===1 || args.length===2 && /^--fixture-name=keryx-run-privacy-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(args[1])),"Explicit isolated acceptance and bounded owned fixture required");
const name=args[1]?.slice("--fixture-name=".length)??`keryx-run-privacy-${randomUUID()}`,label="keryx.run-privacy.fixture",wallet=`0x${"a".repeat(40)}`,other=`0x${"b".repeat(40)}`,session="a".repeat(64);
const docker=(args:string[],input?:string)=>execFileSync("docker",args,{input,encoding:"utf8",timeout:30000,maxBuffer:2*1024*1024,windowsHide:true});
const sql=(input:string)=>docker(["exec","-i",name,"psql","-X","-h","127.0.0.1","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-qAt"],input).trim();
const literal=(value:unknown)=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
const now=Date.now(),date=new Date(now-1000).toISOString(), actor={wallet,sessionHash:session,binding:{network:"eip155:5042002" as const,origin:"https://synthetic-privacy.example"}};
const call=(action:string,id:string|null,input:unknown={},who:unknown=actor,claims=false,role="service_role")=>JSON.parse(sql(`set role ${role};select public.run_privacy_v1('${action}',${id?`'${id}'`:"null"},${literal(input)},${who?literal(who):"null"},${claims});`).split("\n").at(-1)!).result;
const run=(id:string,asker:string|null=wallet)=>({id,createdAt:date,question:`SECRET ${id}`,answer:"SECRET answer",budget:0.1,engine:"fixture",totalSpent:0.012345,totalToCreators:0.000001,subClaims:[],decisions:[],citations:[],trace:[],...(asker?{asker}:{})});
const save=(id:string,asker:string|null=wallet)=>sql(`insert into query_runs(id,created_at,asker,question,answer,budget,engine,total_spent,total_to_creators,data)values('${id}','${date}',${asker?`'${asker}'`:"null"},'SECRET','SECRET',0.1,'fixture',0.012345,0.000001,${literal(run(id,asker))});`);
let created=false;
try {
  docker(["run","-d","--name",name,"--label",`${label}=${name}`,"--network","none","--memory","512m","--cpus","1","-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:17-alpine"]);created=true;
  for(let attempt=0;;attempt++){try{sql("select 1;");break;}catch(error){if(attempt>=30)throw error;await new Promise(done=>setTimeout(done,200));}}
  sql(`create role anon;create role authenticated;create role service_role bypassrls;
    create table query_runs(id text primary key,created_at timestamptz not null,asker text,question text,answer text,budget numeric,engine text,total_spent numeric,total_to_creators numeric,parent_id text,data jsonb not null);
    alter table query_runs add column origin text,add column mcp_client text,add column duration_ms bigint,add column payment_mode text,
      add column payment_attempts integer,add column settled_payments integer,add column confidence_level text,add column evidence_claim_count integer,
      add column grounded_claim_count integer,add column rewarded_citation_count integer,add column economics_data jsonb;
    create table web_sessions(hash text primary key check(hash ~ '^[a-f0-9]{64}$'),wallet text not null check(wallet ~ '^0x[a-f0-9]{40}$'),issued_at bigint not null check(issued_at>=0),expires_at bigint not null check(expires_at>issued_at and expires_at<=issued_at+604800000));
    create table a2a_orders(query_id text not null unique,status text not null,created_at timestamptz not null,started_at timestamptz,
      amount_usdc double precision not null,creator_budget_usdc double precision not null,service_fee_usdc double precision not null,transaction_id text not null,
      request_data jsonb,response_data jsonb,authorization_id text);
    create table query_memories(id text primary key,created_at timestamptz,source_scores jsonb,topics jsonb,sources_read jsonb);
    create table gap_intents(id text primary key,gap_id text,source_id text,source_item_link text,item_id text,content_version text,article_offer_id text,owner_wallet text,status text,attempts integer,retry_run_id text,coverage numeric,reward_usdc numeric,created_at timestamptz,updated_at timestamptz,failed_query_id text,question text,claim text,last_error text);
    create table payment_events(id text primary key,query_id text,amount_usdc numeric,rationale text,payer text,payee text,settled boolean,network text,
      kind text default 'citation',source_id text default 'synthetic-source',source_name text default 'Synthetic creator',tx_hash text,
      settlement_status text default 'pending',created_at timestamptz default '${date}',authorization_phase text);
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
  const predecessorSeals=sql("select jsonb_build_array((select snapshot from anonymous_run_claims_catalog_seal),(select snapshot from run_privacy_catalog_seal))::text;");
  sql("create table research_publication_unadmitted(value text);");
  assert.throws(()=>sql(readFileSync(resolve("supabase/migrations/0093_research_publication.sql"),"utf8")),/privacy_unavailable/);
  sql("drop table research_publication_unadmitted;");
  sql(readFileSync(resolve("supabase/migrations/0093_research_publication.sql"),"utf8"));
  assert.equal(sql("select jsonb_build_array((select snapshot from anonymous_run_claims_catalog_seal),(select snapshot from run_privacy_catalog_seal))::text;"),predecessorSeals,"0093 must not reseal old catalogs");
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
  const pendingId=`a2a_${"d".repeat(64)}`,pending={queryId:pendingId,status:"running",createdAt:date,startedAt:null,
    amountUsdc:0.030001,creatorBudgetUsdc:0.010001,serviceFeeUsdc:0.02,transaction:"original-circle-reference"};
  sql(`insert into a2a_orders(query_id,status,created_at,amount_usdc,creator_budget_usdc,service_fee_usdc,transaction_id,request_data,response_data,authorization_id)
    values('${pendingId}','running','${date}',0.030001,0.010001,0.02,'${pending.transaction}',${literal({question:"SECRET pending"})},${literal({answer:"SECRET pending"})},'SECRET nonce');`);
  const pendingPacket=call("pending",pendingId,{},null);
  // PostgreSQL emits timestamptz as an offset string; compare the exact instant.
  assert.equal(Date.parse(pendingPacket.createdAt),Date.parse(date));
  assert.deepEqual({...pendingPacket,createdAt:date},pending);
  assert.throws(()=>call("pending",pendingId,{},null,false,"anon"));
  save(pendingId);assert.equal(call("pending",pendingId,{},null),null);
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
  sql(`insert into payment_events(id,query_id,amount_usdc,rationale,payer,payee,settled,network) values('fixture','owned',0.000001,'SECRET financial rationale','${wallet}','${other}',false,'eip155:5042002');insert into query_memories values('owned','${date}','{}','["SECRET"]','[]');`);
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
  // #268 uses the actual ordinary RPCs/projection and shared v2 reader in this
  // same network-none fixture. The bridge has fixed SQL operations, no HTTP/provider.
  sql(`insert into web_sessions values('${session}','${wallet}',${now-2000},${now+600000});`);
  const textLiteral=(value:unknown)=>{assert.equal(typeof value,"string");return `'${String(value).replaceAll("'","''")}'`;};
  // Match PostgREST's SQL NULL for absent nullable jsonb RPC arguments.
  // JSON 'null' is a supplied scalar and correctly fails the position validator.
  const positionLiteral=(value:unknown)=>value==null?"null":literal(value);
  const rpc=(method:string,args:Record<string,unknown>)=>{
    const query=method==="anonymous_run_claim_history_list_v1"
      ? `anonymous_run_claim_history_list_v1(${textLiteral(args.p_wallet)},${textLiteral(args.p_network)},${textLiteral(args.p_origin)},${literal(args.p_filters)},${Number(args.p_take)},${positionLiteral(args.p_upper)},${positionLiteral(args.p_before)})`
      : method==="run_privacy_v1" ? `run_privacy_v1(${textLiteral(args.p_action)},${textLiteral(args.p_id)},${literal(args.p_input)},${literal(args.p_actor)},${args.p_claims===true})`
      : method==="research_publication_v1" ? `research_publication_v1(${textLiteral(args.p_action)},${literal(args.p_input)})` : null;
    assert(query,"No additional RPC authority in fixture");
    try{return{data:JSON.parse(sql(`set role service_role;select public.${query};`).split("\n").at(-1)!),error:null};}
    catch{return{data:null,error:{message:"isolated RPC refused"}};}
  };
  const bridge={rpc:(method:string,args:Record<string,unknown>)=>({abortSignal:async()=>rpc(method,args)}),from:(table:string)=>{
    assert.equal(table,"payment_events");let queryId="",take=0;
    const query={select:(fields:string)=>{assert.equal(fields,"id,query_id,kind,source_id,source_name,payer,payee,amount_usdc,network,tx_hash,settled,settlement_status,created_at");return query;},
      eq:(field:string,value:string)=>{assert.equal(field,"query_id");queryId=value;return query;},
      or:(value:string)=>{assert.equal(value,"authorization_phase.is.null,authorization_phase.not.in.(prepared,cancelled_unexposed)");return query;},
      order:(field:string)=>{assert(["created_at","id"].includes(field));return query;},limit:(value:number)=>{assert(value>=1&&value<=201);take=value;return query;},
      abortSignal:async()=>({error:null,data:JSON.parse(sql(`set role service_role;select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from
        (select id,query_id,kind,source_id,source_name,payer,payee,amount_usdc,network,tx_hash,settled,settlement_status,
          to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at from payment_events
          where query_id=${textLiteral(queryId)} and (authorization_phase is null or authorization_phase not in ('prepared','cancelled_unexposed'))
          order by created_at,id limit ${take}) p;`))})};return query;
  }} as unknown as SupabaseClient;
  const historyDB:OwnedHistoryDB={personalHistory:createSupabasePersonalHistory(bridge),runOwnershipHistory:createSupabaseRunOwnershipHistory(bridge),
    runPrivacy:createSupabaseRunPrivacy(bridge,true),runPrivacyActive:true};
  save("history_current");save("history_later");save("history_foreign",other);save("history_claimed",null);
  sql(`set role service_role;select anonymous_run_claim_issue_v1('history_claimed','${"e".repeat(64)}','${date}','${actor.binding.network}','${actor.binding.origin}');
    select anonymous_run_claim_consume_v1('${"e".repeat(64)}','${wallet}','${session}','${actor.binding.network}','${actor.binding.origin}');
    insert into payment_events(id,query_id,amount_usdc,rationale,payer,payee,settled,network,tx_hash,settlement_status)
      values('history_micro','history_current',0.000001,'SECRET retained finance','${wallet}','${other}',true,'eip155:5042002','synthetic-settled-reference','settled');`);
  const historyBinding=actor.binding as RunClaimBinding,originalHistory=sql("select data::text from query_runs where id='history_current';"),
    originalFinances=sql("select md5(string_agg(row_to_json(p)::text,'' order by id)) from payment_events p;");
  const historyPage=await readOwnedHistory(historyDB,wallet,historyBinding,{search:"history_",limit:1});
  assert.equal(historyPage.rows.length,1);assert(historyPage.nextCursor);assert.equal(historyPage.membershipAvailable,false);
  const allHistory=await exportOwnedHistory(historyDB,wallet,historyBinding,{search:"history_"});
  assert.equal(allHistory.complete,true);assert.deepEqual(allHistory.rows.map(row=>row.id).sort(),["history_claimed","history_current","history_later"]);
  assert.equal(allHistory.rows.find(row=>row.id==="history_claimed")?.ownership.method,"claimed");
  assert.equal(allHistory.rows.find(row=>row.id==="history_current")?.ownSettledSpendMicros,1);
  assert.equal(await readOwnedDetail(historyDB,wallet,historyBinding,"history_foreign"),null);
  assert.equal(sql("select data::text from query_runs where id='history_current';"),originalHistory);
  let entered!:()=>void,release!:()=>void;const paused=new Promise<void>(resolve=>{entered=resolve;}),resume=new Promise<void>(resolve=>{release=resolve;});
  const raceDB:OwnedHistoryDB={...historyDB,personalHistory:{...historyDB.personalHistory!,receipts:async(id,take)=>{
    const value=await historyDB.personalHistory!.receipts!(id,take);if(id==="history_current"){entered();await resume;}return value;}}};
  const pendingHistory=readOwnedHistory(raceDB,wallet,historyBinding,{search:"history_current"});
  await Promise.race([paused,pendingHistory.then(()=>{throw Error("Owned read returned before receipt race");})]);
  call("erase","history_current",{revision:0,requestId:randomUUID()});release();
  await assert.rejects(pendingHistory,/history_unavailable/);
  assert.equal(sql("select md5(string_agg(row_to_json(p)::text,'' order by id)) from payment_events p;"),originalFinances);
  assert(!(await exportOwnedHistory(historyDB,wallet,historyBinding,{search:"history_"})).rows.some(row=>row.id==="history_current"));
  // 0093 shares this existing isolated fixture. The real client/helper exercises
  // only the new fixed RPC, never REST, and leaves old source/seals unchanged.
  const publication=createSupabaseResearchPublication(bridge),publicationBefore=sql("select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb)::text from payment_events p;");
  const publicationCall=(action:string,input:unknown,role="service_role")=>JSON.parse(sql(`set role ${role};select public.research_publication_v1('${action}',${literal(input)});`).split("\n").at(-1)!).result;
  const state=(id:string)=>JSON.parse(sql(`select row_to_json(p)::text from run_privacy p where run_id=${textLiteral(id)};`));
  const publicationRun=(id:string,asker:string|null=wallet)=>({...run(id,asker),question:`Synthetic publication ${id}`,answer:"Synthetic publication answer"});
  await publication.creationReady();
  assert.equal(await publication.defaults({...actor,wallet:other}),"public");
  assert.equal(await publication.defaults(actor),"private");
  for(const mode of ["private","unlisted","public"] as const){
    const id=`publication_${mode}`;await publication.saveQueryRun(publicationRun(id),{visibility:mode});
    assert.equal(state(id).visibility,mode);assert.equal(state(id).revision,0);
    assert.equal(call("read",id,{},null).item!==null,mode!=="private");
    assert.equal(call("list",null,{take:2500},null).some((item:{run:{id:string}})=>item.run.id===id),mode==="public");
  }
  await publication.saveQueryRun(publicationRun("publication_missing_default",other));assert.equal(state("publication_missing_default").visibility,"public");
  await publication.saveQueryRun(publicationRun("publication_saved_default"));assert.equal(state("publication_saved_default").visibility,"private");
  await publication.saveQueryRun(publicationRun("publication_anonymous",null));assert.equal(state("publication_anonymous").visibility,"public");
  const hidden=state("demo");await publication.saveQueryRun(publicationRun("demo"),{visibility:"public"});assert.deepEqual(state("demo"),hidden);
  await publication.saveQueryRun(publicationRun("historical"),{visibility:"public"});assert.equal(state("historical").visibility,"unlisted");
  sql(`insert into run_privacy(run_id,visibility,updated_at) values('publication_orphan','private','${date}');`);
  await publication.saveQueryRun(publicationRun("publication_orphan"),{visibility:"public"});assert.equal(state("publication_orphan").visibility,"private");
  const erasedBefore=sql("select data::text from query_runs where id='owned';");
  await assert.rejects(publication.saveQueryRun(publicationRun("owned"),{visibility:"public"}),/privacy_unavailable/);
  assert.equal(sql("select data::text from query_runs where id='owned';"),erasedBefore);
  sql(`insert into run_privacy(run_id,visibility,revision,erased,updated_at) values('publication_tombstone','private',1,true,'${date}');`);
  await assert.rejects(publication.saveQueryRun(publicationRun("publication_tombstone"),{visibility:"public"}),/privacy_unavailable/);
  assert.equal(sql("select count(*) from query_runs where id='publication_tombstone';"),"0");
  for(const role of ["anon","authenticated"]){
    assert.throws(()=>publicationCall("ready",{},role));assert.throws(()=>publicationCall("defaults",{wallet,binding:actor.binding},role));
    for(const permission of ["insert","update","delete","truncate"])assert.equal(sql(`select has_table_privilege('${role}','research_publication_catalog_seal','${permission}');`),"f");
  }
  for(const permission of ["insert","update","delete","truncate"])assert.equal(sql(`select has_table_privilege('service_role','research_publication_catalog_seal','${permission}');`),"f");
  assert.throws(()=>sql(`begin read only;set role service_role;select research_publication_v1('ready','{}');commit;`));
  const saveInput=(await (async()=>{
    let input:unknown;const capture={rpc:(_method:string,args:Record<string,unknown>)=>({abortSignal:async()=>{input=args.p_input;return{data:{version:1,action:"save",id:"publication_rollback",result:{saved:true}},error:null};}})} as unknown as SupabaseClient;
    await createSupabaseResearchPublication(capture).saveQueryRun(publicationRun("publication_rollback"),{visibility:"private"});return input;
  })()) as {row:Record<string,unknown>;publication:{visibility:string}};
  assert.throws(()=>sql(`begin;set role service_role;select research_publication_v1('save',${literal(saveInput)});select 1/0;commit;`));
  assert.equal(sql("select (select count(*) from query_runs where id='publication_rollback')+(select count(*) from run_privacy where run_id='publication_rollback');"),"0");
  for(const invalid of [{},{...saveInput,extra:true},{...saveInput,publication:{visibility:"invalid"}},
    {...saveInput,row:{...saveInput.row,id:`prv_${"a".repeat(64)}`,data:{...publicationRun(`prv_${"a".repeat(64)}`)}}}])assert.throws(()=>publicationCall("save",invalid));
  // Two real connections: first save is uncommitted before the second starts.
  const raceRun=publicationRun("publication_first_race");
  const raceInput={...saveInput,row:{...saveInput.row,id:raceRun.id,question:raceRun.question,data:raceRun}};
  const concurrentSql=(input:string)=>promisify(execFile)("docker",["exec","-i",name,"psql","-X","-h","127.0.0.1","-U","postgres","-d","postgres","-v","ON_ERROR_STOP=1","-qAt","-c",input],{encoding:"utf8",timeout:30000,maxBuffer:2*1024*1024,windowsHide:true});
  const first=concurrentSql(`set application_name='publication0093_first';begin;set role service_role;select research_publication_v1('save',${literal(raceInput)});select pg_sleep(1);commit;`);
  // It is awaited below after the second connection starts. Observe an early
  // rejection now so a fixture failure still reaches the owned finally cleanup.
  void first.catch(()=>{});
  let sleeping=false;for(let attempt=0;attempt<30;attempt++){if(sql("select count(*) from pg_stat_activity where application_name='publication0093_first' and wait_event='PgSleep';")==="1"){sleeping=true;break;}await new Promise(done=>setTimeout(done,25));}
  assert(sleeping,"First actual transaction must be held before race");
  const second=concurrentSql(`set role service_role;select research_publication_v1('save',${literal({...raceInput,publication:{visibility:"public"}})});`);
  await Promise.all([first,second]);assert.equal(state("publication_first_race").visibility,"private");
  // Catalog/schema failures are transactional controls: rollback restores the
  // genuine admitted source; no runtime reseal or schema repair is exercised.
  for(const change of ["truncate research_publication_catalog_seal", "alter table research_publication_catalog_seal add column unexpected text",
    "grant update on research_publication_catalog_seal to service_role", "truncate anonymous_run_claims_catalog_seal",
    "truncate run_privacy_catalog_seal", "alter table query_runs add column publication_unexpected text"]){
    assert.throws(()=>sql(`begin;${change};set role service_role;select research_publication_v1('ready','{}');commit;`));await publication.creationReady();
  }
  assert.equal(sql("select coalesce(jsonb_agg(to_jsonb(p) order by id),'[]'::jsonb)::text from payment_events p;"),publicationBefore);
  assert.equal(sql("select jsonb_build_array((select snapshot from anonymous_run_claims_catalog_seal),(select snapshot from run_privacy_catalog_seal))::text;"),predecessorSeals);
  console.log("Publication0093 actual PostgreSQL: fixed RPC/helper; roles, no-row/saved defaults, all modes, original/sidecar atomic rollback, first-save race, legacy/hidden/erased/orphan preservation, own/predecessor seals and exact financial equality. Synthetic only.");
  sql("create schema keryx_storage;create table keryx_storage.identity(id integer);insert into keryx_storage.identity values(1);");
  await assert.rejects(publication.creationReady(),/privacy_unavailable/);
  await assert.rejects(readOwnedHistory(historyDB,wallet,historyBinding,{search:"history_"}),/history_unavailable|privacy_unavailable/);
  sql("drop schema keryx_storage cascade;");
  console.log("#268 real PostgreSQL v2 composition: recorded/claimed ownership, paging/export, exact micros, receipt-I/O erase and financial retention, enrolled refusal. No membership producer or delivery claim.");
  sql("alter table run_privacy add column unexpected text;");assert.throws(()=>call("read","historical",{},null));
  console.log("#266 PostgreSQL: defaults, all visibility levels, owner/export/erase/retry/revocation, legacy ACL closure, existing claim admission and exact financial equality passed. Synthetic only.");
} finally {
  if(created){const observed=docker(["inspect","--format",`{{ index .Config.Labels "${label}" }}`,name]).replace(/\r?\n$/,"");assert.equal(observed,name,"Refuse non-owned fixture cleanup");docker(["rm","-f",name]);}
}
