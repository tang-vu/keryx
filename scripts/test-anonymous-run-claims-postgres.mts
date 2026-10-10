/** Actual ordinary0088 acceptance in one fresh owned PG17 container only.
 * No ambient PG connection, application env, providers, native reference or shared DDL. */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { runClaimBindingSchema, runClaimIssuanceSchema, runClaimReceiptSchema, RUN_CLAIM_TTL_MS } from "../lib/run-claims/contracts.ts";
import { runOwnershipHistoryRowSchema } from "../lib/run-claims/history.ts";

assert.deepEqual(process.argv.slice(2), ["--acceptance"], "Explicit isolated acceptance mode required");
const fixtureId = randomUUID(), name = `keryx-anonymous-claims-${fixtureId}`, labelKey = "keryx.anonymous-claims.fixture";
const config = mkdtempSync(join(tmpdir(), "keryx-anonymous-claims-docker-"));
const out = resolve("artifacts/anonymous-run-claims-postgres", fixtureId); mkdirSync(out, { recursive: true });
const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, DOCKER_CONFIG: config };
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const text = (value: string) => `'${value.replaceAll("'", "''")}'`;
const cases: string[] = [], receipts: { label: string; exitCode: number | null; stdoutSha256: string; stderrSha256: string }[] = [];
let sequence = 0, containerId: string | undefined, version: string | undefined, imageId: string | undefined, sourceCommit: string | undefined, failure: unknown;
const held = new Set<ChildProcessWithoutNullStreams>();
function record(args: string[], input: string | undefined, stdout: Buffer, stderr: Buffer, exitCode: number | null, signal: string | null, error?: Error, completionMethod = "spawn-sync") {
  const label = `command-${String(++sequence).padStart(4, "0")}`;
  writeFileSync(join(out, `${label}.stdout.raw`), stdout, { flag: "wx" }); writeFileSync(join(out, `${label}.stderr.raw`), stderr, { flag: "wx" });
  const receipt = { label, exitCode, stdoutSha256: hash(stdout), stderrSha256: hash(stderr) }; receipts.push(receipt);
  writeFileSync(join(out, `${label}.json`), JSON.stringify({ ...receipt, args, inputSha256: input === undefined ? null : hash(input),
    stdoutBytes: stdout.length, stderrBytes: stderr.length, signal, error: error?.message ?? null, completionMethod }, null, 2));
}
function docker(args: string[], input?: string): string {
  const result = spawnSync("docker", args, { env, input, timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
  record(args, input, result.stdout ?? Buffer.alloc(0), result.stderr ?? Buffer.alloc(0), result.status, result.signal, result.error);
  if (result.error || result.status !== 0 || result.signal) throw new Error(`Owned Docker command failed: ${result.stderr?.toString("utf8") ?? result.error?.message}`);
  return result.stdout.toString("utf8").trim();
}
const psql = () => ["exec", "-i", name, "psql", "-X", "-w", "-h", "127.0.0.1", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"];
const sql = (statement: string) => docker(psql(), statement);
function sqlAsync(statement: string) {
  const args = [...psql(), "-c", statement], child = spawn("docker", args, { env, stdio: ["pipe", "pipe", "pipe"], timeout: 30_000 }); held.add(child);
  child.stdin.end(); let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), overflow = false;
  child.stdout.on("data", data => { stdout = Buffer.concat([stdout, data]); if (stdout.length > 2 * 1024 * 1024) { overflow = true; child.kill(); } });
  child.stderr.on("data", data => { stderr = Buffer.concat([stderr, data]); if (stderr.length > 2 * 1024 * 1024) { overflow = true; child.kill(); } });
  return new Promise<string>((resolveResult, reject) => {
    let error: Error | undefined; child.on("error", cause => { error = cause; });
    child.on("close", (code, signal) => {
      held.delete(child); record(args, undefined, stdout, stderr, code, signal, error, "close-event");
      if (error || overflow || code !== 0 || signal) reject(new Error(`Owned SQL failed: ${stderr.toString("utf8") || error?.message}`));
      else resolveResult(stdout.toString("utf8").trim());
    });
  });
}
async function waitUntil(condition: () => boolean, description: string) {
  const deadline = Date.now() + 10_000;
  while (!condition()) { if (Date.now() >= deadline) throw new Error(description); await new Promise(resolveDelay => setTimeout(resolveDelay, 25)); }
}
async function hold(statement: string) {
  const args = psql(), child = spawn("docker", args, { env, stdio: ["pipe", "pipe", "pipe"], timeout: 30_000 }); held.add(child);
  let stdout = Buffer.alloc(0), stderr = Buffer.alloc(0), error: Error | undefined;
  child.stdout.on("data", data => { stdout = Buffer.concat([stdout, data]); if (stdout.length > 65536) child.kill(); });
  child.stderr.on("data", data => { stderr = Buffer.concat([stderr, data]); if (stderr.length > 65536) child.kill(); });
  const complete = new Promise<void>((resolveComplete, reject) => {
    child.on("error", cause => { error = cause; });
    child.on("close", (code, signal) => {
      held.delete(child); record(args, statement, stdout, stderr, code, signal, error, "close-event");
      if (error || code !== 0 || signal) reject(new Error("Owned lock holder did not close successfully")); else resolveComplete();
    });
  }); void complete.catch(() => {});
  child.stdin.write(`begin;${statement};select 'CLAIMS_LOCK_HELD';\n`);
  await waitUntil(() => stdout.includes("CLAIMS_LOCK_HELD"), "Owned lock holder unavailable");
  return async () => { child.stdin.end("commit;\n\\q\n"); await complete; };
}
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, network = "eip155:5042002", origin = "https://synthetic-claims.example";
const timestamp = () => sql(`select to_char(clock_timestamp()-interval '1 second' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');`);
const save = (id: string, patch: Record<string, unknown> = {}) => {
  const completed = typeof patch.createdAt === "string" ? patch.createdAt : timestamp(), run = { id, createdAt: completed,
    question: "Synthetic %_ claim fixture", answer: "Synthetic answer", budget: 0, engine: "heuristic", totalSpent: 0.01, totalToCreators: 0.005,
    subClaims: [], decisions: [], citations: [], trace: [], paymentMode: "offline", ...patch };
  sql(`insert into public.query_runs(id,created_at,question,budget,engine,asker,data) values(${text(id)},${text(completed)},'Synthetic claim fixture',0,'heuristic',
    ${typeof patch.asker === "string" ? text(patch.asker.toLowerCase()) : "null"},${text(JSON.stringify(run))}::jsonb);`);
  return completed;
};
const issueSql = (id: string, completed: string, targetOrigin = origin) => `set role service_role;select public.anonymous_run_claim_issue_v1(${text(id)},${text(hash(id))},${text(completed)},${text(network)},${text(targetOrigin)});`;
const consumeSql = (id: string, wallet = alice, targetOrigin = origin) => `set role service_role;select public.anonymous_run_claim_consume_v1(${text(hash(id))},${text(wallet)},${text(hash(wallet))},${text(network)},${text(targetOrigin)});`;
const ready = () => JSON.parse(sql("set role service_role;select public.anonymous_run_claims_ready_v1();"));
const jsonArgument = (value: unknown) => value === null ? "null" : `${text(JSON.stringify(value))}::jsonb`;
const historyListSql = (wallet = alice, targetOrigin = origin, filters = {}, upper: unknown = null, before: unknown = null, take = 51) =>
  `set role service_role;select public.anonymous_run_claim_history_list_v1(${text(wallet)},${text(network)},${text(targetOrigin)},${text(JSON.stringify(filters))}::jsonb,${take},${jsonArgument(upper)},${jsonArgument(before)});`;
const historyReadSql = (id: string, wallet = alice, targetOrigin = origin) =>
  `set role service_role;select public.anonymous_run_claim_history_read_v1(${text(wallet)},${text(network)},${text(targetOrigin)},${text(id)});`;
const claimRows = () => sql("select coalesce(jsonb_agg(to_jsonb(c) order by run_id),'[]') from public.anonymous_run_claims c;");
const originalRows = () => sql("select jsonb_build_array((select jsonb_agg(to_jsonb(r) order by id) from public.query_runs r),(select jsonb_agg(to_jsonb(o) order by id) from public.a2a_orders o),(select jsonb_agg(to_jsonb(p) order by id) from public.payment_events p));");
try {
  const git = spawnSync("git", ["rev-parse", "HEAD"], { env, timeout: 10_000, maxBuffer: 65536 });
  assert.equal(git.status, 0); assert.equal(git.error, undefined); sourceCommit = git.stdout.toString("utf8").trim(); assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  docker(["info", "--format", "{{.ServerVersion}}"]);
  imageId = docker(["image", "inspect", "postgres:17-alpine", "--format", "{{.Id}}"]); assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  containerId = docker(["run", "-d", "--pull=never", "--name", name, "--label", `${labelKey}=${fixtureId}`, "--network", "none", "--memory", "512m", "--cpus", "1",
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"]); assert.match(containerId, /^[a-f0-9]{64}$/);
  await waitUntil(() => { try { return sql("select 1;") === "1"; } catch { return false; } }, "Owned PostgreSQL startup unavailable");
  version = sql("show server_version;"); assert.match(version, /^17\./);
  sql("create role anon;create role authenticated;create role service_role bypassrls;create publication supabase_realtime;");
  for (const file of ["0001_keryx_schema.sql", "0017_query_run_asker.sql", "0038_a2a_orders.sql", "0043_web_sessions.sql", "0044_web_session_wallet_index.sql"])
    sql(readFileSync(`supabase/migrations/${file}`, "utf8"));
  sql("grant select,insert,update,delete on public.query_runs,public.a2a_orders,public.payment_events to service_role;grant select on public.query_runs to anon,authenticated;");
  const migration = readFileSync("supabase/migrations/0088_anonymous_run_claims.sql", "utf8");
  for (const marker of ["public.keryx_storage_identity", "keryx_storage.identity"]) {
    if (marker.startsWith("keryx_storage.")) sql("create schema keryx_storage;"); sql(`create table ${marker}(invalid text);`);
    assert.throws(() => sql(migration), /claims_unavailable/); assert.equal(sql("select to_regclass('public.anonymous_run_claims') is null;"), "t");
    sql(`drop table ${marker};`); if (marker.startsWith("keryx_storage.")) sql("drop schema keryx_storage;");
  } cases.push("empty native markers refuse migration before domain creation");
  sql(migration); assert.deepEqual(ready(), { version: 1, ready: true }); cases.push("source migration and exact catalog readiness");
  const clock = Number(sql("select floor(extract(epoch from clock_timestamp())*1000)::bigint;"));
  for (const wallet of [alice, bob]) sql(`insert into public.web_sessions values(${text(hash(wallet))},${text(wallet)},${clock - 1000},${clock + RUN_CLAIM_TTL_MS * 2});`);
  const completed = save("first");
  sql(`insert into public.sources(id,name,wallet_address) values('synthetic-source','Synthetic source',${text(bob)});
    insert into public.payment_events(id,query_id,source_id,kind,payer,payee,amount_usdc,network,settled,rationale)
    values('synthetic-payment','first','synthetic-source','fetch',${text(bob)},${text(alice)},0.01,${text(network)},false,'Synthetic never-settled fixture');
    insert into public.a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,status,transaction_id,created_at,updated_at)
    values('synthetic-other-order','other-owned-run','synthetic-authorization','synthetic-request',${text(bob)},${text(alice)},0.01,0.005,0.005,'deep','failed','synthetic-never-settled',${text(completed)},${text(completed)});`);
  const before = originalRows(), issued = runClaimIssuanceSchema.parse(JSON.parse(sql(issueSql("first", completed))));
  assert.equal(Date.parse(issued.expiresAt) - Date.parse(issued.issuedAt), RUN_CLAIM_TTL_MS);
  assert.throws(() => sql(issueSql("first", completed)), /claim_unavailable/);
  const receipt = runClaimReceiptSchema.parse(JSON.parse(sql(consumeSql("first")))); assert.equal(receipt.wallet, alice); assert.equal(receipt.runId, "first");
  assert.equal(originalRows(), before); assert.throws(() => sql(consumeSql("first", bob)), /claim_unavailable/); assert.throws(() => sql(consumeSql("unknown")), /claim_unavailable/);
  assert.throws(() => sql("set role service_role;update public.anonymous_run_claims set token_hash=repeat('f',64);"), /permission denied/);
  assert.throws(() => sql("set role service_role;delete from public.anonymous_run_claims;"), /permission denied/);
  assert.throws(() => sql("set role service_role;update public.anonymous_run_claims_catalog_seal set snapshot='{}';"), /permission denied/);
  assert.equal(sql("set role anon;select count(*) from public.query_runs;"), "1"); cases.push("hash-only fixed24h single use, readonly seal, original/financial preservation and legitimate published read");
  const historyBefore = originalRows(), firstOriginal = JSON.parse(sql("select data from public.query_runs where id='first';"));
  const historyFirst = JSON.parse(sql(historyListSql())); assert.deepEqual(historyFirst.binding, { network, origin });
  assert.equal(historyFirst.wallet, alice); assert.equal(historyFirst.rows.length, 1);
  assert.equal(runOwnershipHistoryRowSchema.parse(historyFirst.rows[0]).ownership.method, "claimed");
  assert.equal(historyFirst.rows[0].funding, "other-or-unknown"); assert.doesNotMatch(JSON.stringify(historyFirst), /Synthetic answer|token_hash|tokenHash|original_sha256|sessionHash/);
  assert.deepEqual(JSON.parse(sql(historyReadSql("first"))).item.run, firstOriginal); assert.equal(Object.hasOwn(firstOriginal, "asker"), false);
  assert.equal(JSON.parse(sql(historyReadSql("first", bob))).item, null);
  assert.equal(JSON.parse(sql(historyReadSql("first", alice, "https://other.example"))).item, null);
  assert.deepEqual(JSON.parse(sql(historyListSql(alice, "https://other.example"))).rows, []); assert.equal(originalRows(), historyBefore);
  const tied = timestamp();
  for (const [id, owner] of [["history-a", null], ["history-b", alice], ["history-c", null]] as const) {
    const completed = save(id, { createdAt: tied, ...(owner ? { asker: owner, askerFunded: true } : {}),
      provenance: { version: 1, surface: "web", ownershipMethod: owner ? "session" : "unknown" } });
    if (!owner) { sql(issueSql(id, completed)); sql(consumeSql(id)); }
  }
  const firstPage = JSON.parse(sql(historyListSql(alice, origin, { surface: "web" }, null, null, 2)));
  assert.deepEqual(firstPage.rows.map((row: { id: string }) => row.id), ["history-c", "history-b"]);
  const upper = { createdAt: tied, id: "history-c" }, beforePosition = { createdAt: tied, id: "history-b" };
  save("history-z", { createdAt: tied, asker: alice, provenance: { version: 1, surface: "web", ownershipMethod: "session" } });
  assert.deepEqual(JSON.parse(sql(historyListSql(alice, origin, { surface: "web" }, upper, beforePosition))).rows.map((row: { id: string }) => row.id), ["history-a"]);
  assert.deepEqual(JSON.parse(sql(historyListSql(alice, origin, { surface: "web", funding: "browser-recorded", search: "%_" }))).rows.map((row: { id: string }) => row.id), ["history-b"]);
  sql("update public.query_runs set data=jsonb_set(data,'{answer}','\"changed\"') where id='history-a';");
  assert.equal(JSON.parse(sql(historyReadSql("history-a"))).item, null);
  assert.equal(JSON.parse(sql(historyListSql())).rows.some((row: { id: string }) => row.id === "history-a"), false);
  for (const query of [historyListSql(alice, origin, {}, null, null, 52), historyListSql(alice, origin, { wallet: bob }), historyListSql(alice, origin, {}, { id: "history-c" })])
    assert.throws(() => sql(query), /claims_unavailable/);
  cases.push("owner-private immutable detail and deduped recorded+claimed keyset/filter/binding history, no claimant financial authority");
  for (const role of ["anon", "authenticated"]) for (const table of ["anonymous_run_claims", "anonymous_run_claims_catalog_seal", "web_sessions"])
    assert.throws(() => sql(`set role ${role};select * from public.${table};`), /permission denied/);
  for (const role of ["anon", "authenticated"]) {
    assert.throws(() => sql(`set role ${role};select public.anonymous_run_claims_ready_v1();`), /permission denied/);
    assert.throws(() => sql(historyListSql().replace("set role service_role;", `set role ${role};`)), /permission denied/);
    assert.throws(() => sql(historyReadSql("first").replace("set role service_role;", `set role ${role};`)), /permission denied/);
  }
  cases.push("anonymous/authenticated SQL cannot read claim/session secrets or execute ownership RPCs");
  const origins = [origin, "https://one-two.example:8443", "http://localhost:3939", "http://127.0.0.1", "https://[::1]:3939", "https://localhost",
    "http://remote.example", "https://remote.example:443", "http://localhost:80", "https://remote.example:0", "https://remote.example:08443", "https://REMOTE.example",
    "https://remote.example.", "https://8.8.8.8", "https://127.1", "https://xn--bcher-kva.example", "https://b\u00fccher.example", "https://under_score.example",
    "https://-label.example", "https://example.com/", "https://user@example.com", "https://example.com?secret=fixture", "https://example.com:65536", "https://example.com:65535",
    "https://example.com\n", "https://example.com\r", " https://example.com", "https://example.com "];
  for (const value of origins) {
    const js = runClaimBindingSchema.safeParse({ network, origin: value }).success;
    assert.equal(sql(`set role service_role;select public.anonymous_run_claim_origin_valid_v1(${text(value)});`), js ? "t" : "f", `JS/SQL origin parity: ${value}`);
  } cases.push(`actual SQL/JS canonical origin parity (${origins.length} cases)`);
  const guardCompleted = save("guard-new"), ticketCompleted = save("guard-ticket"); sql(issueSql("guard-ticket", ticketCompleted));
  const mutates = (description: string, mutate: string, restore: string) => {
    const claims = claimRows(), originals = originalRows(); sql(mutate);
    try {
      for (const statement of ["set role service_role;select public.anonymous_run_claims_ready_v1();", issueSql("guard-new", guardCompleted), consumeSql("guard-ticket"), historyListSql(), historyReadSql("first")])
        assert.throws(() => sql(statement), /claims_unavailable/, description);
      assert.equal(claimRows(), claims); assert.equal(originalRows(), originals);
    } finally { sql(restore); }
    assert.deepEqual(ready(), { version: 1, ready: true }); cases.push(description);
  };
  const trigger = sql("select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.anonymous_run_claims'::regclass and tgname='anonymous_run_claims_immutable';");
  mutates("missing immutable trigger refuses ready/issue/consume without writes", "drop trigger anonymous_run_claims_immutable on public.anonymous_run_claims;", trigger);
  mutates("disabled immutable trigger refuses all entrypoints", "alter table public.anonymous_run_claims disable trigger anonymous_run_claims_immutable;", "alter table public.anonymous_run_claims enable trigger anonymous_run_claims_immutable;");
  const immutable = sql("select pg_get_functiondef('public.anonymous_run_claims_immutable_v1()'::regprocedure);");
  mutates("changed immutable function refuses all entrypoints", "create or replace function public.anonymous_run_claims_immutable_v1() returns trigger language plpgsql set search_path=pg_catalog,public as $$ begin return new; end $$;", immutable);
  const check = JSON.parse(sql("select jsonb_build_array(conname,pg_get_constraintdef(oid)) from pg_constraint where conrelid='public.anonymous_run_claims'::regclass and contype='c' and pg_get_constraintdef(oid) like '%expires_at =%';")) as [string, string];
  assert.match(check[0], /^[a-z_0-9]+$/); mutates("missing expiry constraint refuses all entrypoints", `alter table public.anonymous_run_claims drop constraint ${check[0]};`, `alter table public.anonymous_run_claims add constraint ${check[0]} ${check[1]};`);
  for (const role of ["public", "anon", "authenticated"]) {
    mutates(`${role} claim-table ACL refuses all entrypoints`, `grant select on public.anonymous_run_claims to ${role};`, `revoke select on public.anonymous_run_claims from ${role};`);
    mutates(`${role} ownership RPC ACL refuses all entrypoints`, `grant execute on function public.anonymous_run_claim_consume_v1(text,text,text,text,text) to ${role};`, `revoke execute on function public.anonymous_run_claim_consume_v1(text,text,text,text,text) from ${role};`);
    mutates(`${role} ownership-history RPC ACL refuses all entrypoints`, `grant execute on function public.anonymous_run_claim_history_read_v1(text,text,text,text) to ${role};`, `revoke execute on function public.anonymous_run_claim_history_read_v1(text,text,text,text) from ${role};`);
    mutates(`${role} session column ACL refuses all entrypoints`, `grant select(hash) on public.web_sessions to ${role};`, `revoke select(hash) on public.web_sessions from ${role};`);
    mutates(`${role} seal ACL refuses all entrypoints`, `grant select on public.anonymous_run_claims_catalog_seal to ${role};`, `revoke select on public.anonymous_run_claims_catalog_seal from ${role};`);
  }
  mutates("service role cannot gain baseline update authority", "grant update(snapshot) on public.anonymous_run_claims_catalog_seal to service_role;", "revoke update(snapshot) on public.anonymous_run_claims_catalog_seal from service_role;");
  const sealTrigger = sql("select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.anonymous_run_claims_catalog_seal'::regclass and tgname='anonymous_run_claims_seal_immutable';");
  mutates("missing seal trigger refuses all entrypoints", "drop trigger anonymous_run_claims_seal_immutable on public.anonymous_run_claims_catalog_seal;", sealTrigger);
  const ownerIndex = sql("select pg_get_indexdef('public.anonymous_run_claims_owner'::regclass);");
  mutates("changed claim index refuses all entrypoints", "drop index public.anonymous_run_claims_owner;", ownerIndex);
  mutates("extra claim column refuses all entrypoints", "alter table public.anonymous_run_claims add column unsafe text;", "alter table public.anonymous_run_claims drop column unsafe;");
  for (const [id, patch] of [["owned", { asker: alice }], ["original", { originalFulfillment: {} }], ["browser", { askerFunded: true }]] as const) {
    const time = save(id, patch); assert.throws(() => sql(issueSql(id, time)), /claim_unavailable/);
  }
  const malformedTime = save("123"); sql("update public.query_runs set data=jsonb_set(data,'{id}','123') where id='123';");
  assert.throws(() => sql(issueSql("123", malformedTime)), /claim_unavailable/);
  const modifiedTime = save("modified"); sql(issueSql("modified", modifiedTime)); sql("update public.query_runs set data=jsonb_set(data,'{answer}','\"changed\"') where id='modified';");
  assert.throws(() => sql(consumeSql("modified")), /claim_unavailable/);
  assert.throws(() => sql(consumeSql("guard-ticket", alice, "https://other.example")), /claim_unavailable/);
  cases.push("owned/original/browser/modified/binding mismatches refuse without transfer");
  // Explicit synthetic backdated fixture, not a clock override or a historical
  // mint API: exercise actual expiration without a 24-hour acceptance sleep.
  const past = sql(`select to_char(clock_timestamp()-interval '2 days' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');`);
  save("expired"); sql(`update public.query_runs set created_at=${text(past)},data=jsonb_set(data,'{createdAt}',to_jsonb(${text(past)}::text)) where id='expired';
    with t as materialized(select floor(extract(epoch from clock_timestamp())*1000)::bigint as stamp)
    insert into public.anonymous_run_claims(run_id,network,origin,token_hash,original_sha256,completed_at,issued_at,expires_at)
    select 'expired',${text(network)},${text(origin)},${text(hash("expired"))},public.anonymous_run_claim_original_v1('expired',${text(past)}),${text(past)},
      stamp-${RUN_CLAIM_TTL_MS}-1000,stamp-1000 from t;`);
  assert.throws(() => sql(consumeSql("expired")), /claim_unavailable/); cases.push("actual expired fixture uses same unavailable refusal and remains unclaimed");
  const paidTime = save("paid-original"); sql(`insert into public.a2a_orders(id,query_id,authorization_id,request_hash,payer,payee,amount_usdc,creator_budget_usdc,service_fee_usdc,research_mode,status,transaction_id,created_at,updated_at)
    values('synthetic-failed-order','paid-original','synthetic-authorization','synthetic-request',${text(alice)},${text(bob)},0.01,0.005,0.005,'deep','failed','synthetic-never-settled',${text(paidTime)},${text(paidTime)});`);
  assert.throws(() => sql(issueSql("paid-original", paidTime)), /claim_unavailable/); cases.push("paid-order original cannot acquire anonymous ownership ticket");
  const raceTime = save("race"); sql(issueSql("race", raceTime));
  const racers = await Promise.allSettled([sqlAsync(consumeSql("race", alice)), sqlAsync(consumeSql("race", bob))]);
  assert.equal(racers.filter(result => result.status === "fulfilled").length, 1); assert.equal(racers.filter(result => result.status === "rejected").length, 1);
  for (const result of racers) if (result.status === "rejected") assert.match(String(result.reason), /claim_unavailable/);
  assert.equal(sql("select count(*) from public.anonymous_run_claims where run_id='race' and claimed_wallet is not null;"), "1"); cases.push("actual two-wallet concurrent consume has exactly one winner");
  const revokeTime = save("revoke-wait"); sql(issueSql("revoke-wait", revokeTime));
  const release = await hold(`delete from public.web_sessions where hash=${text(hash(alice))}`);
  const waiting = Promise.allSettled([sqlAsync(`set application_name='anonymous-claim-revoke-wait';${consumeSql("revoke-wait")}`)]);
  await waitUntil(() => sql("select count(*) from pg_stat_activity where application_name='anonymous-claim-revoke-wait' and wait_event_type='Lock';") === "1", "Claimant did not reach real session lock wait");
  await release(); const [revoked] = await waiting; assert.equal(revoked.status, "rejected"); if (revoked.status === "rejected") assert.match(String(revoked.reason), /claim_unauthenticated/);
  assert.equal(sql("select claimed_wallet is null from public.anonymous_run_claims where run_id='revoke-wait';"), "t"); cases.push("session revocation rechecked after observed lock wait");
  const deadline = Number(sql("select floor(extract(epoch from clock_timestamp())*1000)::bigint;")) + 6000;
  sql(`insert into public.web_sessions values(${text(hash(alice))},${text(alice)},${deadline - 7000},${deadline});`);
  const expiryTime = save("session-expiry-wait"); sql(issueSql("session-expiry-wait", expiryTime));
  const releaseTicket = await hold("select 1 from public.anonymous_run_claims where run_id='session-expiry-wait' for update");
  const expiring = Promise.allSettled([sqlAsync(`set application_name='anonymous-claim-expiry-wait';${consumeSql("session-expiry-wait")}`)]);
  await waitUntil(() => sql("select count(*) from pg_stat_activity where application_name='anonymous-claim-expiry-wait' and wait_event_type='Lock';") === "1", "Claimant did not reach real ticket lock wait");
  await waitUntil(() => Number(sql("select floor(extract(epoch from clock_timestamp())*1000)::bigint;")) >= deadline, "Owned DB session deadline did not expire");
  await releaseTicket(); const [expiredSession] = await expiring; assert.equal(expiredSession.status, "rejected");
  if (expiredSession.status === "rejected") assert.match(String(expiredSession.reason), /claim_unauthenticated/);
  assert.equal(sql("select claimed_wallet is null from public.anonymous_run_claims where run_id='session-expiry-wait';"), "t"); cases.push("active session expiry refreshed after observed ticket lock wait");
  for (const marker of ["public.keryx_storage_identity", "keryx_storage.identity"]) {
    if (marker.startsWith("keryx_storage.")) sql("create schema keryx_storage;grant usage on schema keryx_storage to service_role;");
    sql(`create table ${marker}(invalid text);insert into ${marker} values('invalid-native-marker');`);
    for (const statement of ["set role service_role;select public.anonymous_run_claims_ready_v1();", issueSql("guard-new", guardCompleted), consumeSql("guard-ticket"), historyListSql(), historyReadSql("first")]) assert.throws(() => sql(statement), /claims_unavailable/);
    sql(`drop table ${marker};`); if (marker.startsWith("keryx_storage.")) sql("drop schema keryx_storage;");
  } cases.push("later native markers refuse all ordinary entrypoints");
} catch (error) { failure = error; }
finally {
  for (const child of held) child.kill();
  if (containerId) {
    try {
      assert.match(containerId, /^[a-f0-9]{64}$/);
      assert.equal(docker(["inspect", containerId, "--format", `{{.Id}} {{index .Config.Labels ${JSON.stringify(labelKey)}}}`]), `${containerId} ${fixtureId}`);
      docker(["rm", "-f", containerId]); assert.equal(docker(["ps", "-aq", "--filter", `id=${containerId}`]), "");
    } catch (error) { failure ??= error; }
  }
  assert.ok(resolve(config).startsWith(resolve(tmpdir()) + sep) && config.includes("keryx-anonymous-claims-docker-")); rmSync(config, { recursive: true, force: true });
  const sourcePaths = ["supabase/migrations/0088_anonymous_run_claims.sql", "lib/run-claims/contracts.ts", "lib/run-claims/history.ts",
    "lib/history/personal-history.ts", "lib/research/run-provenance.ts", "lib/llm/well-formed-utf16.ts",
    "scripts/test-anonymous-run-claims-postgres.mts", "tsconfig.anonymous-run-claims.json", ".github/workflows/anonymous-run-claims-postgres.yml"];
  writeFileSync(join(out, "acceptance.json"), JSON.stringify({ format: "keryx-ordinary-anonymous-run-claims-postgres-acceptance-v1", accepted: !failure,
    syntheticOnly: true, nativeEnrollment: false, sharedDDL: false, operationalClearance: false, sourceCommit, serverVersion: version, imageId, cases, receipts,
    sourceHashes: Object.fromEntries(sourcePaths.map(file => [file, hash(readFileSync(file))])), failure: failure instanceof Error ? failure.message : failure ? String(failure) : null }, null, 2), { flag: "wx" });
}
if (failure) throw failure;
console.log(`Anonymous run claims PostgreSQL17 actual acceptance passed: ${cases.length} cases; synthetic owned container removed; source-pinned raw receipts in ${out}.`);
