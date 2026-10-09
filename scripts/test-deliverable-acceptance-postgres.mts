/** Actual0087 and relevant original migrations, fresh owned PG17, synthetic bookkeeping only. */
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syntheticA2aOriginal } from "../lib/db/a2a-original-fixture.ts";
import { monthlyOrderToRow } from "../lib/db/research-monthly.ts";
import { createSupabaseDeliverableAcceptance } from "../lib/db/deliverable-acceptance-supabase.ts";

const execute = promisify(execFile), name = `keryx-acceptance-${randomUUID()}`, database = `acceptance_${randomUUID().replaceAll("-", "")}`;
const argv = process.argv.slice(2); let bin: string | undefined, port: string | undefined, cluster: string | undefined;
if (argv.length) {
  assert.equal(argv.length, 6); assert.equal(argv[0], "--psql-bin"); assert.equal(argv[2], "--port"); assert.equal(argv[4], "--cluster-dir");
  assert.ok(isAbsolute(argv[1])); bin = realpathSync(join(argv[1], process.platform === "win32" ? "psql.exe" : "psql"));
  port = argv[3]; assert.match(port, /^[1-9]\d{3,4}$/); assert.ok(Number(port) <= 65535); assert.ok(isAbsolute(argv[5])); cluster = realpathSync(argv[5]);
}
const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  PGPASSFILE: join(tmpdir(), `${name}-no-password`), PGSERVICEFILE: join(tmpdir(), `${name}-no-service`), PGCONNECT_TIMEOUT: "5", PGSSLMODE: "disable", PGAPPNAME: "synthetic-deliverable-acceptance" };
const docker = (args: string[], input?: string) => execFileSync("docker", args, { input, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
const clientArgs = (db: string) => ["-X", "-w", "-h", "127.0.0.1", ...(port ? ["-p", port] : []), "-U", "postgres", "-d", db, "-qAt", "-v", "ON_ERROR_STOP=1"];
const sql = (statement: string, db = database): string => (bin ? execFileSync(bin, clientArgs(db), { env, input: statement, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 }) : docker(["exec", "-i", name, "psql", ...clientArgs(db)], statement)).trim();
const asyncSql = async (statement: string) => {
  const result = bin ? await execute(bin, [...clientArgs(database), "-c", statement], { env, timeout: 30000, maxBuffer: 8 * 1024 * 1024 })
    : await execute("docker", ["exec", name, "psql", ...clientArgs(database), "-c", statement], { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  return result.stdout.trim();
};
const text = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${text(JSON.stringify(value))}::jsonb`;
const owner = syntheticA2aOriginal().order.payer, other = `0x${"33".repeat(20)}`, authority = { kind: "api-key" as const, id: "synthetic-key" };
const fixture = syntheticA2aOriginal(), { order, binding } = fixture;
const statement = (operation: string, args: Record<string, unknown>) => {
  const values = operation === "deliverable_acceptance_metrics_v1" ? [text(String(args.p_network))]
    : operation === "deliverable_acceptance_public_v1" ? [text(String(args.p_network)), text(String(args.p_id))]
    : [text(String(args.p_owner)), text(String(args.p_network)), text(String(args.p_id))];
  if (operation === "deliverable_acceptance_submit_v1") values.push(json(args.p_input), json(args.p_authority), text(String(args.p_original_sha256)));
  assert.ok(["deliverable_acceptance_read_v1", "deliverable_acceptance_submit_v1", "deliverable_acceptance_public_v1", "deliverable_acceptance_metrics_v1"].includes(operation));
  return `set role service_role; select public.${operation}(${values.join(",")});`;
};
const portClient = { rpc: async (operation: string, args: Record<string, unknown>) => {
  try { return { data: JSON.parse(await asyncSql(statement(operation, args))), error: null }; }
  catch (error) { const message = String(error); process.stderr.write(String((error as { stderr?: string }).stderr ?? "Synthetic PG transport failed\n")); return { data: null, error: { code: "P0001", message: message.includes("acceptance_conflict") ? "acceptance_conflict" : message.includes("acceptance_unauthenticated") ? "acceptance_unauthenticated" : "acceptance_unavailable" } }; }
} } as unknown as SupabaseClient;
let container = false, created = false;
try {
  if (!bin) {
    docker(["info", "--format", "{{.ServerVersion}}"]); container = true;
    docker(["run", "-d", "--name", name, "--network", "none", "--memory", "512m", "--cpus", "1", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"]);
    const deadline = Date.now() + 30000;
    for (;;) { try { assert.equal(sql("select 1;", "postgres"), "1"); break; } catch (cause) { if (Date.now() >= deadline) throw new Error("Owned PG startup unavailable", { cause }); await new Promise(resolve => setTimeout(resolve, 100)); } }
  } else assert.match(execFileSync(bin, ["--version"], { env, encoding: "utf8", timeout: 10000 }), /PostgreSQL\) 17\./);
  assert.match(sql("show server_version;", "postgres"), /^17\./);
  if (cluster) assert.equal(realpathSync(sql("show data_directory;", "postgres")), cluster);
  created = true; sql(`create database ${database};`, "postgres");
  sql("do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$; alter role service_role bypassrls; create publication supabase_realtime;");
  const prerequisites = ["0001_keryx_schema.sql", "0005_api_keys.sql", "0007_payment_origin.sql", "0013_api_key_scopes.sql", "0028_payment_settlement_state.sql",
    "0038_a2a_orders.sql", "0039_async_a2a_jobs.sql", "0040_a2a_operator_resolution.sql", "0041_a2a_research_packages.sql", "0043_web_sessions.sql", "0078_research_monthly.sql"];
  for (const file of prerequisites) sql(readFileSync(`supabase/migrations/${file}`, "utf8"));
  sql("grant select,insert,update,delete on all tables in schema public to service_role;");
  sql(readFileSync("supabase/migrations/0087_deliverable_acceptance.sql", "utf8"));
  for (const role of ["anon", "authenticated"]) {
    assert.throws(() => sql(`set role ${role}; select * from public.deliverable_acceptance_entries;`), /permission denied/);
    assert.throws(() => sql(`set role ${role}; select public.deliverable_acceptance_read_v1('${owner}','${binding.network}','${order.id}');`), /permission denied/);
    assert.throws(() => sql(`set role ${role}; select public.deliverable_acceptance_submit_v1('${owner}','${binding.network}','${order.id}','{}','{}','');`), /permission denied/);
  }
  const completed = { ...order, status: "completed", response: { status: "completed", queryId: order.id, answer: "Synthetic delivered answer 😀" } };
  sql(`insert into public.a2a_orders select (jsonb_populate_record(null::public.a2a_orders,${json(monthlyOrderToRow(completed as typeof order))})).*;
    insert into public.payment_events(id,kind,query_id,source_id,source_name,payer,payee,amount_usdc,tx_hash,network,settled,settlement_status,authorization_id)
      values('inbound_${order.id}','inbound','${order.id}','a2a','Synthetic caller','${owner}','${order.payee}',0.03,'${order.transaction}','${binding.network}',true,'settled','${order.authorizationId}');
    insert into public.api_keys(id,prefix,key_hash,wallet,scopes) values('synthetic-key','synthetic-prefix','synthetic-no-secret','${owner}',' deliverable:read, deliverable:write ');`);
  const portStore = createSupabaseDeliverableAcceptance(portClient), initial = await portStore.read(owner, binding.network, order.id);
  assert.equal(initial.state, "no_response"); assert.equal(initial.terms.responseWindow, null);
  const input = { originalFingerprint: initial.originalFingerprint, deliveredDigest: initial.deliveredDigest, expectedRevision: 0,
    idempotencyKey: "synthetic-request-0001", choice: "accept" as const, reason: "Private synthetic reason 😀", publishState: true };
  const before = sql("select jsonb_agg(to_jsonb(o)) from public.a2a_orders o;") + sql("select jsonb_agg(to_jsonb(p)) from public.payment_events p;");
  const lookup = { p_owner: owner, p_network: binding.network, p_id: order.id };
  const retained = JSON.parse(sql(statement("deliverable_acceptance_read_v1", lookup))) as { originalText: string };
  const originalHash = sql(`select encode(sha256(convert_to(${text(retained.originalText)},'UTF8')),'hex');`);
  for (const invalid of [{ ...input, reason: "😀".repeat(501) }, { ...input, reason: "Unsafe\u0001reason" }, { ...input, unexpected: true }]) {
    assert.throws(() => sql(statement("deliverable_acceptance_submit_v1", { ...lookup, p_input: invalid, p_authority: authority, p_original_sha256: originalHash })), /acceptance_unavailable/);
    assert.equal(sql("select count(*) from public.deliverable_acceptance_entries;"), "0");
  }
  const simultaneous = await Promise.allSettled([portStore.submit(owner, binding.network, order.id, input, authority),
    portStore.submit(owner, binding.network, order.id, { ...input, idempotencyKey: "synthetic-request-0002", choice: "reject" }, authority)]);
  assert.equal(simultaneous.filter(result => result.status === "fulfilled").length, 1);
  const winner = simultaneous.find(result => result.status === "fulfilled")!; assert.equal(winner.status, "fulfilled");
  const winningInput = simultaneous[0].status === "fulfilled" ? input : { ...input, idempotencyKey: "synthetic-request-0002", choice: "reject" as const };
  const replay = await portStore.submit(owner, binding.network, order.id, winningInput, authority);
  assert.equal(replay.revision, 1); assert.equal(sql("select count(*) from public.deliverable_acceptance_entries;"), "1");
  await assert.rejects(() => portStore.submit(owner, binding.network, order.id, { ...winningInput, reason: "Conflicting replay" }, authority), /acceptance_conflict/);
  assert.equal(sql("select jsonb_agg(to_jsonb(o)) from public.a2a_orders o;") + sql("select jsonb_agg(to_jsonb(p)) from public.payment_events p;"), before);
  const shared = await portStore.publicState(binding.network, order.id); assert.ok(shared.state !== "not_shared"); assert.deepEqual(Object.keys(shared).sort(), ["format", "state", "submittedAt"]);
  const counts = await portStore.metrics(binding.network); assert.equal(counts.accepted + counts.rejected, 1); assert.equal(counts.acceptanceRate, null); assert.equal(counts.outsideCustomers, null);
  await assert.rejects(() => portStore.read(other, binding.network, order.id), /acceptance_unavailable/);
  await assert.rejects(() => portStore.read(owner, "eip155:5042", order.id), /acceptance_unavailable/);
  sql(`insert into public.payment_events(id,kind,query_id,source_id,source_name,payer,payee,amount_usdc,tx_hash,network,settled,settlement_status,authorization_id)
    values('synthetic-pending','citation','${order.id}','synthetic-source','Synthetic','${order.payee}','${other}',0.001,'','${binding.network}',false,'pending','0x${"44".repeat(32)}');`);
  const requested = await portStore.submit(owner, binding.network, order.id, { ...input, expectedRevision: 1, idempotencyKey: "synthetic-request-0003", choice: "revise", publishState: false }, authority);
  assert.equal(requested.pendingPaymentLegs, true); assert.equal(requested.revisionExecution, "withheld"); assert.equal(requested.refundExecution, "withheld");
  assert.equal((await portStore.publicState(binding.network, order.id)).state, "not_shared");
  assert.equal((await portStore.metrics(binding.network)).accepted, 0);
  // Hold the exact durable authority row while a still-valid submission waits; it expires before acquisition.
  const expiring = "cd".repeat(32);
  sql(`insert into public.web_sessions values('${expiring}','${owner}',floor(extract(epoch from clock_timestamp())*1000)::bigint-1000,floor(extract(epoch from clock_timestamp())*1000)::bigint+1500);`);
  const holder = asyncSql(`begin; select 1 from public.web_sessions where hash='${expiring}' for update; select pg_sleep(2.5); commit; -- acceptance-expiry-holder`);
  const observed = async (condition: string) => {
    const deadline = Date.now() + 5000;
    for (;;) { if (sql(`select exists(${condition});`) === "t") return; assert.ok(Date.now() < deadline, "Owned PG lock wait was not observed"); await new Promise(resolve => setTimeout(resolve, 20)); }
  };
  await observed("select 1 from pg_stat_activity where query like '%acceptance-expiry-holder%' and wait_event='PgSleep'");
  const waiting = portStore.submit(owner, binding.network, order.id, { ...input, expectedRevision: 2, idempotencyKey: "synthetic-expiry-request" }, { kind: "session", id: expiring });
  void waiting.catch(() => {});
  await observed(`select 1 from pg_stat_activity where query like '%${expiring}%' and wait_event_type='Lock'`);
  assert.equal(sql(`select expires_at>floor(extract(epoch from clock_timestamp())*1000)::bigint from public.web_sessions where hash='${expiring}';`), "t");
  await holder; await assert.rejects(() => waiting, /acceptance_unauthenticated/);
  assert.equal(sql("select count(*) from public.deliverable_acceptance_entries;"), "2");
  sql("update public.api_keys set revoked_at=now() where id='synthetic-key';");
  await assert.rejects(() => portStore.submit(owner, binding.network, order.id, { ...input, expectedRevision: 2, idempotencyKey: "synthetic-request-0004" }, authority), /acceptance_unauthenticated/);
  const hash = "ab".repeat(32); sql(`insert into public.web_sessions values('${hash}','${owner}',floor(extract(epoch from clock_timestamp())*1000)::bigint-1000,floor(extract(epoch from clock_timestamp())*1000)::bigint+60000);`);
  const rejected = await portStore.submit(owner, binding.network, order.id, { ...input, expectedRevision: 2, idempotencyKey: "synthetic-request-0004", choice: "reject" }, { kind: "session", id: hash });
  assert.equal(rejected.pendingPaymentLegs, true); assert.equal(rejected.review, "owner_review_required");
  sql(`delete from public.web_sessions where hash='${hash}';`);
  await assert.rejects(() => portStore.submit(owner, binding.network, order.id, { ...input, expectedRevision: 3, idempotencyKey: "synthetic-request-0005" }, { kind: "session", id: hash }), /acceptance_unauthenticated/);
  sql(`update public.a2a_orders set response_data=jsonb_set(response_data,'{answer}','"Changed synthetic delivery"') where id='${order.id}';`);
  await assert.rejects(() => portStore.submit(owner, binding.network, order.id, input, authority), /acceptance_conflict|acceptance_unavailable/);
  assert.equal((await portStore.publicState(binding.network, order.id)).state, "not_shared");
  assert.throws(() => sql("set role service_role; update public.deliverable_acceptance_entries set data='{}';"), /permission denied/);
  assert.throws(() => sql("update public.deliverable_acceptance_entries set data='{}';"), /acceptance_unavailable/);
  const entriesBefore = sql("select count(*) from public.deliverable_acceptance_entries;");
  sql("create schema keryx_storage; create table keryx_storage.identity(id text); grant usage on schema keryx_storage to service_role;");
  await assert.rejects(() => portStore.read(owner, binding.network, order.id), /acceptance_unavailable/);
  await assert.rejects(() => portStore.submit(owner, binding.network, order.id, input, authority), /acceptance_unavailable/);
  assert.equal(sql("select count(*) from public.deliverable_acceptance_entries;"), entriesBefore);
  process.stdout.write("PASS actual PG17 source migrations and Supabase adapter: concurrent CAS, exact-key lost-ack replay, closed SQL input, original/payment parity, public consent withdrawal/counts, active key/session authority including observed authority-lock wait across expiry, foreign owner/rail and sealed refusal. Synthetic bookkeeping only; no vendor/funding/native enrollment or execution proof.\n");
} finally {
  if (created) sql(`drop database ${database} with (force);`, "postgres");
  if (container) docker(["rm", "-f", name]);
}
