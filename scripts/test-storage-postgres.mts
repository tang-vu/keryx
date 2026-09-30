import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { SupabaseAuthority } from "../lib/db/supabase-authority";
import { recordSupabaseWithdrawal } from "../lib/db/withdrawal-records";
import { storageIdentityDigest, STORAGE_TESTNET_PROFILE_DIGEST, type StorageIdentity } from "../lib/db/storage-identity";

// Actual PostgreSQL, synthetic data only. No app environment, credentials, mounts,
// published ports or settlement. Missing engine is a failure, never a skipped gate.
const name = `keryx-storage-test-${Date.now()}`;
const binary = process.platform === "win32" ? "wsl.exe" : "docker";
const prefix = process.platform === "win32" ? ["-d", "Ubuntu", "--", "docker"] : [];
const docker = (args: string[], input?: string) => execFileSync(binary, [...prefix, ...args],
  { input, encoding: "utf8", timeout: 60_000, stdio: ["pipe", "pipe", "pipe"] });
const psql = ["exec", "-i", name, "psql", "-h", "127.0.0.1", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"];
const sql = (statement: string) => docker(psql, "set statement_timeout='30s'; set lock_timeout='5s'; "+statement).trim();
const sqlIn = (database: string, statement: string) => docker([...psql,"-d",database],"set statement_timeout='30s'; set lock_timeout='5s'; "+statement).trim();
const service = (statement: string) => sql(`set role service_role; ${statement};`);
const json = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const identity: StorageIdentity = { format: "keryx-storage-identity-v1", deploymentId: "11111111-1111-4111-8111-111111111111",
  storageId: "22222222-2222-4222-8222-222222222222", network: "eip155:5042002", authorityMode: "testnet-real",
  profileDigest: STORAGE_TESTNET_PROFILE_DIGEST, enrollmentId: "33333333-3333-4333-8333-333333333333",
  enrolledAt: "2026-10-01T00:00:00.000Z", provenanceDigest: "a".repeat(64) };
const expected = json(identity);
const signer = `0x${"a".repeat(40)}`, payee = `0x${"2".repeat(40)}`;
const nonce = (id: number) => `0x${id.toString(16).padStart(64, "0")}`;
const rpc = (operation: string, ...args: string[]) => `select public.storage_${operation}(${[expected,...args].join(",")})`;
const state = () => sql(`select jsonb_build_object('grants',(select jsonb_agg(g) from public.session_grants g),
  'intents',(select jsonb_agg(i) from public.browser_authorization_intents i),
  'payments',(select jsonb_agg(p) from public.payment_events p),
  'writers',(select count(*) from keryx_storage.writer))`);
const concurrent = (statement: string) => new Promise<string>((resolve, reject) => {
  const child = execFile(binary,[...prefix,...psql],{encoding:"utf8",timeout:30_000},
    (error,stdout,stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout.trim()));
  child.stdin!.end(`set role service_role; begin; ${statement}; select pg_sleep(0.05); commit;`);
});
let started = false;
const httpName = `${name}-postgrest`;
let httpStarted = false;
try {
  docker(["info","--format","{{.ServerVersion}}"]);
  docker(["run","-d","--name",name,"--network","none","--memory","512m","--cpus","1",
    "-e","POSTGRES_HOST_AUTH_METHOD=trust","postgres:17"]); started = true;
  let ready = false;
  for (let attempt=0;attempt<30;attempt++) {
    try { docker(["exec",name,"pg_isready","-h","127.0.0.1","-U","postgres"]); ready=true; break; }
    catch { await new Promise(resolve=>setTimeout(resolve,100)); }
  }
  assert(ready,"isolated PostgreSQL failed to start");
  const migrations = readdirSync("supabase/migrations").filter(f=>/^\d{4}.*\.sql$/.test(f)).sort();
  const migrationText = (files: string[]) => files.map(f=>readFileSync(`supabase/migrations/${f}`,"utf8")).join("\n");
  const historical = migrations.filter(f=>Number(f.slice(0,4))<=69), candidate = migrations.filter(f=>Number(f.slice(0,4))>=70);
  sql("create role anon; create role authenticated; create role service_role bypassrls; create publication supabase_realtime;\n"+migrationText(historical));
  const legacyPayment = (id: string,status: string,settled: boolean) => `insert into public.payment_events(id,kind,query_id,source_id,payer,payee,amount_usdc,network,settled,settlement_status)
    values('${id}','fetch','query','source','${signer}','${payee}',0.000001,'eip155:5042002',${settled},'${status}')`;
  sql(legacyPayment("historical-simulation","simulated",false));
  sql("create database storage_pre_cutover template postgres");
  sql(migrationText(candidate));
  const legacyCases = [
    ["pending",legacyPayment("legacy-pending","pending",false)],
    ["settled",legacyPayment("legacy-settled","settled",true)],
    ["withdrawal",`insert into public.withdrawals(tx_hash,wallet,recipient,amount_usdc,network) values('synthetic-old','${signer}','${payee}',0.000001,'eip155:5042002')`],
    ["treasury",`insert into public.private_treasury_pools(signer,capacity_micros) values('${signer}',1)`],
  ];
  for (const [label,seed] of legacyCases) {
    const database = `legacy_${label}`;
    sql(`create database ${database} template storage_pre_cutover`);
    sqlIn(database,seed+";"+migrationText(candidate));
    const original = sqlIn(database,"select jsonb_build_object('payments',(select jsonb_agg(p) from public.payment_events p),'withdrawals',(select jsonb_agg(w) from public.withdrawals w),'pools',(select jsonb_agg(p) from public.private_treasury_pools p))");
    const digest = sqlIn(database,"select keryx_storage.snapshot_digest()");
    assert.throws(()=>sqlIn(database,`select keryx_storage.enroll(${expected},'${digest}')`),/legacy .*authority requires separate quarantine/);
    assert.equal(sqlIn(database,"select jsonb_build_object('payments',(select jsonb_agg(p) from public.payment_events p),'withdrawals',(select jsonb_agg(w) from public.withdrawals w),'pools',(select jsonb_agg(p) from public.private_treasury_pools p))"),original,"legacy refusal must preserve original funded rows");
    assert.equal(sqlIn(database,"select count(*) from keryx_storage.identity"),"0");
  }
  assert.equal(service("select public.read_storage_identity()"),"");
  assert.throws(()=>service(rpc("get_source","'source'")),/enrollment_required/);
  assert.equal(sql(`select keryx_storage.identity_digest(${expected})`),storageIdentityDigest(identity));
  assert.throws(()=>docker(psql,"select keryx_storage.snapshot_digest()"),/bounded owner statement deadline required/);
  assert.throws(()=>docker(psql,"set statement_timeout='100ms'; select pg_sleep(0.25)"),/statement timeout/);
  const before = sql("select keryx_storage.snapshot_digest()");
  // Native binary bytes, embedded text and exact numeric representations all enter
  // owner CAS. This table is included even though it was not in a selected ledger scan.
  sql("create table public.synthetic_extra(id text primary key,bytes bytea,value numeric,content text)");
  assert.notEqual(sql("select keryx_storage.snapshot_digest()"),before);
  assert.throws(()=>sql(`select keryx_storage.enroll(${expected},'${before}')`),/provenance changed|fence incomplete/);
  // No blanket application grants: owner fixture adds the same required fences.
  sql(`create trigger storage_authority_writer before insert or update or delete on public.synthetic_extra
    for each row execute function keryx_storage.write_fence();
    create trigger storage_authority_no_truncate before truncate on public.synthetic_extra
    for each statement execute function keryx_storage.write_fence();`);
  sql("create type public.synthetic_state as enum ('unbound')");
  const enumSnapshot = sql("select keryx_storage.snapshot_digest()");
  sql("alter type public.synthetic_state rename value 'unbound' to 'reviewed'");
  assert.notEqual(sql("select keryx_storage.snapshot_digest()"),enumSnapshot,"enum label mutation must change full schema CAS");
  assert.throws(()=>sql(`select keryx_storage.enroll(${expected},'${enumSnapshot}')`),/provenance changed/);
  const snapshot = sql("select keryx_storage.snapshot_digest()");
  sql(`select keryx_storage.enroll(${expected},'${snapshot}')`);
  sql(`select keryx_storage.enroll(${expected},'${snapshot}')`);
  assert.deepEqual(JSON.parse(service("select public.read_storage_identity()")),identity);
  assert.throws(()=>service(`select keryx_storage.enroll(${expected},'${snapshot}')`),/permission denied/);
  for(const command of ["select * from public.session_grants","select * from public.sources",
    "insert into keryx_storage.writer values(1,'fake','fake')","update keryx_storage.identity set identity='{}'",
    "truncate public.payment_events","select public.create_auth_challenge('x',0,1)",
    "select public.release_browser_journal_capacity('epoch','signer',1)"])
    assert.throws(()=>service(command),/permission denied/);
  assert.throws(()=>sql("update keryx_storage.identity set identity='{}'"),/immutable/);
  assert.throws(()=>sql("truncate keryx_storage.identity"),/immutable/);
  for(const invalid of [null,[],{}, {...identity,storageId:"44444444-4444-4444-8444-444444444444"},
    {...identity,enrolledAt:"2026-10-01T00:00:00Z"},{...identity,profileDigest:"b".repeat(64)},
    {...identity,extra:"unexpected"}])
    assert.throws(()=>service(`select public.storage_get_source(${json(invalid)},'source')`),/storage identity refused/);
  const source = {id:"source",name:"Synthetic",url:"https://synthetic.example",description:"synthetic",wallet_address:payee,
    fetch_price:0.000001,tags:[],authors:[],created_at:"2026-10-01T00:00:00Z",active:true,verified:true};
  service(rpc("upsert_source",json(source)));
  assert.equal(JSON.parse(service(rpc("get_source","'source'"))).wallet_address,payee);
  assert.throws(()=>service(`begin; ${rpc("get_source","'source'")}; update public.sources set wallet_address='fake'; commit`),/permission denied/);
  assert.equal(sql("select count(*) from keryx_storage.writer"),"0");
  assert.throws(()=>service(`select set_config('keryx.storage_authority','ready',true); update public.sources set wallet_address='fake'`),/permission denied/);
  assert.equal(service(`begin; create temp table sources(id text,wallet_address text); insert into sources values('source','fake');
    ${rpc("get_source","'source'")}; rollback`).includes(payee),true);
  const grant={session_id:"owner",sess_addr:signer,owner_addr:payee,cap:0.000002,spent:0,
    expiry:Date.now()+3600_000,tx_hash:"synthetic-no-funding",grant_epoch:"epoch"};
  service(rpc("upsert_session_grant",json(grant)));
  const intent=(id:number)=>({nonce:nonce(id),session_id:"owner",request_id:`request-${id}`,query_id:"query",
    grant_epoch:"epoch",signer,network:"eip155:5042002",token:"0x3600000000000000000000000000000000000000",
    gateway_contract:"0x0077777d7EBA4688BDeF3E311b846F25870A19B9",source_id:"source",offer_id:null,kind:"fetch",
    payee,amount_micro_usdc:"1",created_at:"2026-10-01T00:00:00Z"});
  const results = await Promise.all([1,2,3].map(id=>concurrent(rpc("admit_browser_authorization",json(intent(id))))));
  assert.deepEqual(results.sort(),["admitted","admitted","grant_or_cap_refused"]);
  const held=state();
  assert.throws(()=>service(rpc("admit_browser_authorization",json({...intent(4),network:"eip155:5042"}))),/testnet|network|Invalid/);
  assert.equal(state(),held,"refusal must preserve grants, intents and writer state");
  service(rpc("activate_browser_journal"));
  service(rpc("upsert_browser_journal_grant",json({...grant,cap:0.000006,grant_epoch:"epoch-2"})));
  const i={...intent(5),grant_epoch:"epoch-2"};
  const requirements={scheme:"exact",network:i.network,asset:i.token,amount:"1",payTo:payee,maxTimeoutSeconds:604900,
    extra:{name:"GatewayWalletBatched",version:"1",verifyingContract:i.gateway_contract}};
  const payment={kind:i.kind,queryId:i.query_id,sourceId:i.source_id,sourceName:"Synthetic",payer:signer,payee,
    amountUsdc:0.000001,network:i.network,grantEpoch:i.grant_epoch,offerId:null,origin:"web"};
  assert.equal(service(rpc("admit_browser_journal",json(i),json(requirements),json(payment))),"admitted");
  assert.equal(sql("select count(*) from keryx_storage.writer"),"0");
  assert.equal(sql("select count(*) from public.browser_journal_writer"),"0");
  assert.throws(()=>service(rpc("record_payment",json({id:"foreign",kind:"fetch",query_id:"query",source_id:"source",payer:signer,
    payee,amount_usdc:0.000001,network:"eip155:5042",settled:false,settlement_status:"pending"}))),/network refused/);
  assert.throws(()=>service(rpc("record_payment",json({id:"sim",kind:"fetch",query_id:"query",source_id:"source",payer:signer,
    payee,amount_usdc:0.000001,network:"eip155:5042002",settled:false,settlement_status:"simulated"}))),/simulated writer refused/);
  docker(["restart",name]);
  for(let attempt=0;attempt<30;attempt++){try{docker(["exec",name,"pg_isready","-h","127.0.0.1","-U","postgres"]);break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert.equal(JSON.parse(service("select public.read_storage_identity()")).storageId,identity.storageId);
  assert.equal(sql("select count(*) from keryx_storage.writer"),"0");
  // Actual PostgREST + actual supabase-js, inside the same isolated network
  // namespace. No published ports, app credentials, host mounts or JWT secrets.
  sql("create role storage_http login; grant service_role to storage_http");
  docker(["run","-d","--name",httpName,"--network",`container:${name}`,"--memory","256m","--cpus","0.5",
    "-e","PGRST_DB_URI=postgres://storage_http@127.0.0.1:5432/postgres","-e","PGRST_DB_ANON_ROLE=service_role",
    "-e","PGRST_DB_SCHEMAS=public","-e","PGRST_DB_CONFIG=false","-e","PGRST_DB_POOL=2",
    "postgrest/postgrest:v12.2.3"]); httpStarted = true;
  const httpFetch: typeof fetch = async (input,init) => {
    const path = new URL(String(input)).pathname.replace(/^\/rest\/v1/,"");
    if (!/^\/rpc\/(?:read_storage_identity|storage_[a-z0-9_]+)$/.test(path)) throw new Error("Unexpected synthetic HTTP operation");
    const output = docker(["run","--rm","-i","--network",`container:${name}`,"--memory","64m","--cpus","0.25",
      "curlimages/curl:8.12.1","--max-time","10","--silent","--show-error","--request","POST",
      "--header","Content-Type: application/json","--data-binary","@-","--write-out","\n%{http_code}",
      `http://127.0.0.1:3000${path}`],String(init?.body ?? "{}"));
    const split = output.lastIndexOf("\n"), status = Number(output.slice(split+1));
    return new Response(status===204 ? null : output.slice(0,split),{status,headers:{"Content-Type":"application/json"}});
  };
  const httpClient = createClient("http://synthetic.invalid","synthetic-no-authority",{
    auth:{persistSession:false},global:{fetch:httpFetch},
  });
  const authority = new SupabaseAuthority(httpClient,identity);
  let httpReady = false;
  for(let attempt=0;attempt<10;attempt++) {
    try { await authority.init(); httpReady=true; break; }
    catch(error) { if(attempt===9) throw error; await new Promise(resolve=>setTimeout(resolve,200)); }
  }
  assert(httpReady,"actual PostgREST did not become ready");
  assert.equal((await authority.rpc("get_source",{p_id:"source"})).data.wallet_address,payee);
  assert.equal((await authority.rpc("get_source",{p_id:"absent"})).data,null);
  assert.deepEqual((await authority.rpc("list_sources",{p_active:true})).data.map((r:{id:string})=>r.id),["source"]);
  await authority.rpc("create_auth_challenge",{p_hash:"f".repeat(64),p_issued_at:1,p_expires_at:3});
  assert.equal((await authority.rpc("consume_auth_challenge",{p_hash:"f".repeat(64),p_now:2})).data,true);
  assert.equal((await authority.rpc("consume_auth_challenge",{p_hash:"f".repeat(64),p_now:2})).data,false);
  const wrong = {...identity,storageId:"44444444-4444-4444-8444-444444444444"};
  const rejected = await httpClient.rpc("storage_get_source",{p_expected_identity:wrong,p_id:"source"});
  assert.equal(rejected.error?.code,"P0001");
  let domainCalls = 0;
  const wrongClient = createClient("http://synthetic.invalid","synthetic-no-authority",{
    auth:{persistSession:false},global:{fetch:async(input,init)=>{
      const body = JSON.parse(String(init?.body ?? "{}"));
      if(new URL(String(input)).pathname.includes("/storage_")) {
        domainCalls++; body.p_expected_identity=wrong;
      }
      return httpFetch(input,{...init,body:JSON.stringify(body)});
    }},
  });
  const wrongAuthority = new SupabaseAuthority(wrongClient,identity); await wrongAuthority.init();
  await assert.rejects(recordSupabaseWithdrawal(wrongAuthority,{txHash:`0x${"ab".repeat(32)}`,label:"synthetic-storage-identity-refusal",wallet:signer,
    recipient:payee,amountUsdc:0.000001,network:"eip155:5042002",createdAt:"2026-10-01T00:00:00.000Z"}),
    /^Error: Withdrawal record write unavailable$/);
  assert.equal(domainCalls,1,"SQL refusal must not become readback, fallback or settlement success");
  assert.equal(sql("select count(*) from public.withdrawals"),"0");
  assert.equal(sql("select count(*) from keryx_storage.writer"),"0");
  console.log("isolated PostgreSQL storage identity, role denial, CAS, concurrency, journal composition and restart: passed");
} finally {
  if(httpStarted) docker(["rm","-f","-v",httpName]);
  if(started) docker(["rm","-f","-v",name]);
}
