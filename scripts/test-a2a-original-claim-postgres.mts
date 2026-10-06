/** Actual 0081 SQL in disposable PostgreSQL; synthetic fixtures, no signing or settlement. */
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { syntheticA2aOriginal } from "../lib/db/a2a-original-fixture";
import { monthlyOrderToRow } from "../lib/db/research-monthly";
import { a2aRequestHash } from "../lib/a2a/order";

const name = `keryx-original-test-${randomUUID()}`;
const binary = "docker";
const prefix: string[] = [];
const docker = (args: string[], input?: string) => execFileSync(binary, [...prefix, ...args],
  { input, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
// The image's temporary init server accepts Unix sockets before restarting.
// TCP admission waits for the final server and also binds every later session.
const psql = ["exec", "-i", name, "psql", "-h", "127.0.0.1", "-U", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"];
const sql = (input: string) => docker(psql, input).trim();
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${literal(JSON.stringify(value))}::jsonb`;
const fixture = syntheticA2aOriginal();
const at = "2026-10-06T03:24:02.000Z";
const proof = (expected = fixture.binding) => `select public.has_original_a2a_settlement_v1(${json(expected)})`;
const claim = (worker: string, expected = fixture.binding) =>
  `select id from public.claim_original_a2a_order_v1(${json(expected)},${literal(worker)},${literal(at)}::timestamptz)`;
const concurrent = (statement: string) => new Promise<string>((resolve, reject) => {
  const child = execFile(binary, [...prefix, ...psql], { encoding: "utf8", timeout: 30000 },
    (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  child.stdin!.end(`set role service_role; begin; ${statement}; select pg_sleep(0.25); commit;`);
});
function seed(value = fixture) {
  const { order, binding } = value;
  sql(`insert into public.a2a_orders select (jsonb_populate_record(null::public.a2a_orders,${json(monthlyOrderToRow(order))})).*;
    set role service_role;
    select public.claim_research_purchase(${json({ network: binding.network, asset: binding.asset,
      payer: binding.payer, payee: binding.payee, authorization_id: binding.authorizationId, product: "a2a",
      purchase_id: binding.id, request_hash: binding.requestHash, amount_micros: Number(binding.amountMicroUsdc),
      requireExisting: false, issued_data: null })});
    reset role;
    insert into public.payment_events(id,payer,payee,network,authorization_id,amount_usdc,kind,query_id,
      source_id,settled,settlement_status,tx_hash) values(${literal(`inbound_${order.id}`)},${literal(order.payer)},
      ${literal(order.payee)},${literal(binding.network)},${literal(order.authorizationId)},${order.amountUsdc},
      'inbound',${literal(order.id)},'a2a',true,'settled',${literal(order.transaction)});`);
}
let started = false;
try {
  docker(["run", "-d", "--name", name, "--network", "none", "--memory", "512m", "--cpus", "1",
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17"]); started = true;
  const deadline = Date.now() + 30000;
  while (true) {
    try { assert.equal(sql("select 1;"), "1"); break; }
    catch (cause) { if (Date.now() > deadline) throw new Error("Owned PostgreSQL startup unavailable", { cause });
      await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  const prerequisite = readFileSync("supabase/migrations/0038_a2a_orders.sql", "utf8")
    + readFileSync("supabase/migrations/0039_async_a2a_jobs.sql", "utf8")
    + `alter table public.a2a_orders add column package_data jsonb, add column resolution_data jsonb,
        add column execution_journal_version smallint, add column payment_started_at timestamptz, add column result_saving_at timestamptz;
      create table public.payment_events(id text,payer text,payee text,network text,authorization_id text,amount_usdc numeric,kind text,query_id text);
      grant all on public.a2a_orders to service_role;`;
  sql("create role anon;create role authenticated;create role service_role bypassrls;" + prerequisite
    + "begin;" + readFileSync("supabase/migrations/0078_research_monthly.sql", "utf8") + "commit;"
    + `alter table public.payment_events add column source_id text,add column settled boolean,
        add column settlement_status text,add column tx_hash text;create table public.query_runs(id text primary key);`
    + readFileSync("supabase/migrations/0081_exact_a2a_original_claim.sql", "utf8"));
  seed(); const foreign = syntheticA2aOriginal(2); seed(foreign);
  const before = sql(`select row_to_json(a)::text from a2a_orders a order by id;`);
  assert.equal(sql(`set role service_role;begin read only;${proof()};commit;`), "t");
  assert.equal(sql(`set role service_role;${proof(syntheticA2aOriginal(3).binding)};`), "f");
  for (const field of ["requestHash", "packageFingerprint"] as const) {
    const wrong = { ...fixture.binding, [field]: "aa".repeat(32) };
    assert.equal(sql(`set role service_role;${claim("wrong", wrong)};`), "");
    assert.equal(sql(`set role service_role;${proof(wrong)};`), "f");
  }
  const rowId = literal(fixture.order.id), inboundId = literal(`inbound_${fixture.order.id}`);
  const mutations = [
    `delete from payment_events where id=${inboundId}`,
    ...["settled=false", "settlement_status='failed'", "tx_hash=null", "amount_usdc=0.031",
      "network='eip155:5042'", "payer='0x3333333333333333333333333333333333333333'",
      "payee='0x3333333333333333333333333333333333333333'", "authorization_id='0xwrong'",
      "query_id='foreign-query'", "source_id='foreign-source'"].map(set => `update payment_events set ${set} where id=${inboundId}`),
    `update a2a_orders set request_data=jsonb_set(request_data,'{question}','"different"') where id=${rowId}`,
    `update a2a_orders set request_data=jsonb_set(request_data,'{network}','"eip155:5042"') where id=${rowId}`,
    `update a2a_orders set request_data=jsonb_set(request_data,'{monthlyId}','"monthly_original"') where id=${rowId}`,
    `insert into research_monthly values('monthly_${"ab".repeat(32)}',${literal(fixture.binding.payer)},'{}');
      insert into research_monthly_redemptions values('monthly_${"ab".repeat(32)}','synthetic-slot',${rowId},
        ${literal(fixture.binding.requestHash)},${literal(at)},0)`,
  ];
  for (const mutation of mutations) {
    assert.equal(sql(`begin;${mutation};set role service_role;${proof()};rollback;`), "f");
    assert.equal(sql(`begin;${mutation};set role service_role;${claim("held")};rollback;`), "");
  }
  for (const mutation of [
    ...["execution_journal_version=null", "worker_id='prior-worker'", "started_at='2026-10-06T03:23:03Z'",
      "payment_started_at='2026-10-06T03:23:03Z'", "result_saving_at='2026-10-06T03:23:03Z'",
      "amount_usdc=0.031", "creator_budget_usdc=0.011", "service_fee_usdc=0.021",
      "package_data=jsonb_set(package_data,'{version}','\"unsupported\"')"].map(set => `update a2a_orders set ${set} where id=${rowId}`),
    `insert into query_runs values(${rowId})`,
    `insert into payment_events(id,query_id,kind) values('prior-attempt',${rowId},'fetch')`,
  ]) assert.equal(sql(`begin;${mutation};set role service_role;${claim("held")};rollback;`), "");
  assert.equal(sql(`select row_to_json(a)::text from a2a_orders a order by id;`), before);
  // Match JS UTF-16 bounds, including astral characters; JSON escaping/hash parity is real SQL.
  const astral = syntheticA2aOriginal(4), question = "\u{1f512}".repeat(5001);
  astral.order.request!.question = question;
  astral.order.requestHash = a2aRequestHash({ ...astral.order, question, model: astral.order.request!.model });
  astral.binding.requestHash = astral.order.requestHash; seed(astral);
  assert.equal(sql(`set role service_role;${claim("overlong", astral.binding)};`), "");
  const whitespace = syntheticA2aOriginal(5);
  whitespace.order.request!.question = "\t\n\u00a0\ufeff";
  whitespace.order.requestHash = a2aRequestHash({ ...whitespace.order, question: whitespace.order.request!.question, model: whitespace.order.request!.model });
  whitespace.binding.requestHash = whitespace.order.requestHash; seed(whitespace);
  assert.equal(sql(`set role service_role;${claim("whitespace", whitespace.binding)};`), "");
  assert.throws(() => sql(`set role service_role;${claim("\t\n\u00a0\ufeff", foreign.binding)};`), /worker refused/);
  const outcomes = await Promise.all([concurrent(claim("worker-a")), concurrent(claim("worker-b"))]);
  assert.equal(outcomes.filter(output => output.includes(fixture.order.id)).length, 1);
  assert.equal(sql(`set role service_role;${claim("worker-c")};`), "");
  assert.equal(sql(`select row_to_json(a)::text from a2a_orders a where id=${literal(foreign.order.id)};`),
    before.split("\n").find(line => JSON.parse(line).id === foreign.order.id));
  sql(`update a2a_orders set status='completed' where id=${rowId};insert into query_runs values(${rowId});`);
  assert.equal(sql(`set role service_role;begin read only;${proof()};commit;`), "t");
  for (const role of ["anon", "authenticated"]) for (const signature of [
    "public.claim_original_a2a_order_v1(jsonb,text,timestamp with time zone)", "public.has_original_a2a_settlement_v1(jsonb)",
  ]) assert.equal(sql(`select has_function_privilege('${role}','${signature}','EXECUTE');`), "f");
  for (const role of ["anon", "authenticated", "service_role"])
    assert.equal(sql(`select has_function_privilege('${role}','public.a2a_original_binding_matches_v1(public.a2a_orders,jsonb)','EXECUTE');`), "f");
  sql("create schema keryx_storage;create table keryx_storage.identity(identity jsonb);insert into keryx_storage.identity values('{}');");
  for (const operation of [claim("sealed", foreign.binding), proof(foreign.binding)])
    assert.throws(() => sql(`set role service_role;${operation};`), /unavailable in enrolled storage/);
  console.log("PASS: actual 0081 PostgreSQL; independent-session one winner, exact settled proof, readonly snapshot, foreign/history/Monthly/save holds, Unicode/hash parity, private ACLs, sealed refusal. Synthetic fixtures only.");
} finally { if (started) docker(["rm", "-f", name]); }
