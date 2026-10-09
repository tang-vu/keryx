/** Actual additive0085 SQL in an owned, network-isolated PostgreSQL. No app env/runtime/provider I/O. */
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { identityRecordSchema, identitySnapshotSchema } from "../lib/profiles/verified-identities.ts";
const name = `keryx-profile-identities-${randomUUID()}`;
const docker = (args: string[], input?: string) => execFileSync("docker", args, { input, encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
const sqlArgs = ["exec", "-i", name, "psql", "-h", "127.0.0.1", "-U", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"];
const sql = (statement: string) => docker(sqlArgs, statement).trim();
const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, charlie = `0x${"c".repeat(40)}`;
const profile = { displayName: "Alice", handle: "", bio: "Researcher", purpose: "Papers", links: [] };
const github = { provider: "github", externalId: "12345", label: "Alice" };
const orcid = { provider: "orcid", externalId: "0000-0002-1825-0097", label: "Alice Researcher" };
const update = (wallet: string) => `set role service_role; select private_profile_update_v1('${wallet}',${literal(profile)});`;
type Challenge = { wallet: string; provider: string; state: string; session: string; deadline: string };
const params = (c: Challenge) => `'${c.wallet}','${c.provider}','${c.state}','${c.session}','${c.deadline}'::timestamptz`;
const begin = (c: Challenge) => `set role service_role;select profile_identity_begin_v1(${params(c)});`;
const consume = (c: Challenge) => `set role service_role;select profile_identity_consume_v1(${params(c)});`;
const complete = (c: Challenge, identity: unknown = github) => `set role service_role;select profile_identity_complete_v1(${params(c)},${literal(identity)});`;
const unlink = (wallet: string, provider = "github") => sql(`set role service_role;select profile_identity_unlink_v1('${wallet}','${provider}');`);
const list = (wallet = alice) => identitySnapshotSchema.parse(JSON.parse(sql(`set role service_role;select profile_identities_list_v1('${wallet}');`)));
const asyncExec = promisify(execFile);
const asyncSql = (statement: string) => asyncExec("docker", [...sqlArgs, "-c", statement], { timeout: 30_000, maxBuffer: 1024 * 1024 });
const heldSessions = new Set<ChildProcessWithoutNullStreams>();
const waitUntil = async (condition: () => boolean, message: string, deadlineMs = 10_000) => {
  const deadline = Date.now() + deadlineMs;
  while (!condition()) { if (Date.now() >= deadline) throw new Error(message); await new Promise(resolve => setTimeout(resolve, 25)); }
};
const hold = async (statement: string) => {
  const child = spawn("docker", sqlArgs, { stdio: ["pipe", "pipe", "pipe"], timeout: 30_000 }); heldSessions.add(child);
  let output = "", errors = "";
  child.stdout.setEncoding("utf8").on("data", data => { output += data; });
  child.stderr.setEncoding("utf8").on("data", data => { errors += data; });
  const exit = new Promise<void>((resolve, reject) => {
    child.on("error", reject); child.on("close", code => { heldSessions.delete(child); if (code === 0) resolve(); else reject(new Error(errors || `Owned SQL session exited ${code}`)); });
  });
  void exit.catch(() => {}); // A failed barrier is reported by waitUntil; cleanup still owns this process.
  // Observe psql's marker only after the transaction has actually acquired its locks.
  child.stdin.write(`begin;${statement};select 'HELD';\n`);
  await waitUntil(() => output.includes("HELD"), "Owned SQL lock barrier unavailable");
  return async () => { child.stdin.end("commit;\n\\q\n"); await exit; };
};
const waitForBlocked = async (application: string) => waitUntil(() => sql(`select count(*) from pg_stat_activity where application_name='${application}' and wait_event_type='Lock';`) === "1", "Contending request did not reach the observed lock barrier");
const waitForDeadline = async (deadline: string) => waitUntil(() => Number(sql("select floor(extract(epoch from clock_timestamp())*1000)::bigint;")) >= Date.parse(deadline), "Owned DB deadline did not expire");
let created = false;
try {
  docker(["info", "--format", "{{.ServerVersion}}"]);
  docker(["run", "-d", "--pull=never", "--name", name, "--network", "none", "--memory", "512m", "--cpus", "1", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"]); created = true;
  const startupDeadline = Date.now() + 30_000;
  while (true) {
    try { assert.equal(sql("select 1;"), "1"); break; }
    catch (cause) { if (Date.now() >= startupDeadline) throw new Error("Owned PostgreSQL startup unavailable", { cause }); await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  sql(`create role anon;create role authenticated;create role service_role bypassrls;
    create table public.users(wallet_address text primary key,first_seen_at timestamptz);
    create table public.query_runs(id text primary key,asker text,origin text);
    create table public.query_memories(id text primary key,topics jsonb);
    create table public.payment_events(id text primary key,query_id text,payee text,kind text,network text,settled boolean,settlement_status text,tx_hash text,amount_usdc numeric);
    grant select on public.users,public.query_runs,public.query_memories,public.payment_events to service_role;`);
  sql(readFileSync("supabase/migrations/0043_web_sessions.sql", "utf8"));
  sql(readFileSync("supabase/migrations/0083_private_profiles.sql", "utf8"));
  const migration = readFileSync("supabase/migrations/0085_profile_verified_identities.sql", "utf8"); sql(migration);
  const now = Number(sql("select floor(extract(epoch from clock_timestamp())*1000)::bigint;"));
  const challenge = (tag: string, wallet = alice, provider = "github", deadline = now + 600_000): Challenge => ({ wallet, provider,
    state: hash(tag), session: hash(wallet), deadline: new Date(deadline).toISOString() });
  for (const wallet of [alice, bob]) { sql(update(wallet)); sql(`insert into web_sessions values('${hash(wallet)}','${wallet}',${now - 1000},${now + 3_600_000});`); }
  sql(`insert into web_sessions values('${hash(charlie)}','${charlie}',${now - 1000},${now + 3_600_000});`);
  const retained = () => sql("select jsonb_build_array((select jsonb_agg(s order by hash) from web_sessions s),(select jsonb_agg(p order by id) from payment_events p),(select jsonb_agg(r order by id) from query_runs r));");
  const before = retained();
  assert.deepEqual(list(), { wallet: alice, identities: [] });
  assert.throws(() => sql(begin(challenge("no-profile", charlie))), /profile_required/);
  const first = challenge("first"); sql(begin(first));
  assert.throws(() => sql(complete(first)), /identity_expired/); sql(consume(first));
  assert.throws(() => sql(consume(first)), /identity_expired/);
  const record = identityRecordSchema.parse(JSON.parse(sql(complete(first)))); assert.equal(record.externalId, github.externalId);
  assert.throws(() => sql(complete(first)), /identity_expired/); assert.throws(() => sql(begin(first)), /identity_expired/);
  const replacement = challenge("replace"); sql(begin(replacement)); assert.deepEqual(list().identities, [record]);
  for (const changed of [{ wallet: bob, session: hash(bob) }, { session: hash(bob) }, { provider: "orcid" }, { state: hash("wrong") },
    { deadline: new Date(now + 600_001).toISOString() }]) assert.throws(() => sql(consume({ ...replacement, ...changed })), /identity_expired/);
  sql(consume(replacement)); assert.throws(() => sql(complete(replacement, orcid)), /identity_unavailable/);
  sql(complete(replacement, { ...github, externalId: "67890", label: "Alice-new" }));
  const oc = challenge("orcid", alice, "orcid"); sql(begin(oc)); sql(consume(oc)); sql(complete(oc, orcid)); assert.equal(list().identities.length, 2);
  assert.deepEqual(list(bob).identities, []);
  // Actual UNIQUE-index contention on separate database connections.
  unlink(alice); const ca = challenge("race-alice"), cb = challenge("race-bob", bob);
  for (const c of [ca, cb]) { sql(begin(c)); sql(consume(c)); }
  const contenders = await Promise.allSettled([asyncSql(complete(ca)), asyncSql(complete(cb))]);
  assert.equal(contenders.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(sql("select count(*) from profile_verified_identities where provider='github' and external_id='12345';"), "1");
  // A collision never replaces the loser's previous verified record.
  unlink(alice); unlink(bob); const old = challenge("bob-old", bob); sql(begin(old)); sql(consume(old)); sql(complete(old, { ...github, externalId: "99999", label: "Bob" }));
  const winner = challenge("alice-winner"); sql(begin(winner)); sql(consume(winner)); sql(complete(winner));
  const losing = challenge("bob-losing", bob); sql(begin(losing)); sql(consume(losing)); assert.throws(() => sql(complete(losing)), /profile_verified_identities_provider_external_id_key/);
  assert.equal(list(bob).identities[0].externalId, "99999");
  assert.throws(() => sql(begin(challenge("session-long", alice, "github", now + 3_600_001))), /identity_expired/);
  for (const tag of ["expired", "wrong-session"]) {
    const c = challenge(tag); if (tag === "expired") c.deadline = new Date(now - 1).toISOString(); else c.session = hash("missing");
    assert.throws(() => sql(begin(c)), /identity_expired/);
  }
  for (const point of ["before-consume", "before-complete"]) {
    const c = challenge(`revoked-${point}`); sql(begin(c)); if (point === "before-complete") sql(consume(c));
    sql(`delete from web_sessions where hash='${hash(alice)}';`);
    assert.throws(() => sql(point === "before-complete" ? complete(c) : consume(c)), /identity_expired/);
    sql(`insert into web_sessions values('${hash(alice)}','${alice}',${now - 1000},${now + 3_600_000});`);
  }
  for (const action of ["unlink", "profile-delete", "replace-start"]) {
    const c = challenge(`in-flight-${action}`); sql(begin(c)); sql(consume(c));
    if (action === "unlink") unlink(alice);
    if (action === "profile-delete") { sql(`set role service_role;select private_profile_delete_v1('${alice}');`); sql(update(alice)); }
    if (action === "replace-start") sql(begin(challenge("replacement-start")));
    assert.throws(() => sql(complete(c)), /identity_expired/);
  }
  for (let i = 0; i < 40; i++) { sql(begin(challenge(`bounded-${i}`))); assert.equal(sql(`select count(*) from profile_identity_challenges where wallet='${alice}' and provider='github';`), "1"); }
  // Completion rechecks actual wall-clock deadline after consume.
  const shortNow = Number(sql("select floor(extract(epoch from clock_timestamp())*1000)::bigint;"));
  const short = challenge("short", alice, "github", shortNow + 3000); sql(begin(short)); sql(consume(short));
  await new Promise(resolve => setTimeout(resolve, 3100)); assert.throws(() => sql(complete(short)), /identity_expired/);
  // Hold the owner row on another connection; observe the contending request's lock wait before release.
  const lockNow = Number(sql("select floor(extract(epoch from clock_timestamp())*1000)::bigint;"));
  const queued = challenge("blocked-expiry", alice, "github", lockNow + 3000);
  const releaseOwner = await hold(`select 1 from private_profiles where wallet='${alice}' for update`);
  const ownerResult = Promise.allSettled([asyncSql(`set application_name='identity-owner-wait';${begin(queued)}`)]);
  await waitForBlocked("identity-owner-wait"); await waitForDeadline(queued.deadline); await releaseOwner();
  const [blocked] = await ownerResult; assert.equal(blocked.status, "rejected");
  if (blocked.status === "rejected") assert.match(String(blocked.reason), /identity_expired/);
  // A UNIQUE-index wait is later than active()'s first check. Release the conflicting identity only
  // AFTER observing both that wait and deadline expiry; completion must roll back to the old link.
  unlink(alice); unlink(bob);
  const oldAlice = challenge("old-alice"); sql(begin(oldAlice)); sql(consume(oldAlice)); sql(complete(oldAlice, { ...github, externalId: "55555", label: "Alice-old" }));
  const ownedBob = challenge("owned-bob", bob); sql(begin(ownedBob)); sql(consume(ownedBob)); sql(complete(ownedBob));
  const uniqueNow = Number(sql("select floor(extract(epoch from clock_timestamp())*1000)::bigint;"));
  const waiting = challenge("unique-expiry", alice, "github", uniqueNow + 3000); sql(begin(waiting)); sql(consume(waiting));
  const releaseIdentity = await hold(`delete from profile_verified_identities where wallet='${bob}' and provider='github'`);
  const uniqueResult = Promise.allSettled([asyncSql(`set application_name='identity-unique-wait';${complete(waiting)}`)]);
  await waitForBlocked("identity-unique-wait"); await waitForDeadline(waiting.deadline); await releaseIdentity();
  const [late] = await uniqueResult; assert.equal(late.status, "rejected"); if (late.status === "rejected") assert.match(String(late.reason), /identity_expired/);
  assert.equal(list().identities.find(identity => identity.provider === "github")?.externalId, "55555");
  const signatures = ["profile_identities_ordinary_v1(text,text)", "profile_identity_active_v1(text,text,text,text,timestamptz)", "profile_identities_list_v1(text)",
    "profile_identity_begin_v1(text,text,text,text,timestamptz)", "profile_identity_consume_v1(text,text,text,text,timestamptz)",
    "profile_identity_complete_v1(text,text,text,text,timestamptz,jsonb)", "profile_identity_unlink_v1(text,text)"];
  for (const role of ["anon", "authenticated"]) {
    for (const table of ["profile_verified_identities", "profile_identity_challenges"]) {
      assert.equal(sql(`select has_table_privilege('${role}','public.${table}','SELECT');`), "f"); assert.throws(() => sql(`set role ${role};select * from ${table};`));
    }
    for (const signature of signatures) assert.equal(sql(`select has_function_privilege('${role}','public.${signature}','EXECUTE');`), "f");
  }
  assert.equal(retained(), before);
  const identityBefore = sql("select jsonb_build_array((select jsonb_agg(l order by wallet,provider) from profile_verified_identities l),(select jsonb_agg(c order by state_hash) from profile_identity_challenges c));");
  sql("create schema keryx_storage;create table keryx_storage.identity(id integer);insert into keryx_storage.identity values(1);grant usage on schema keryx_storage to service_role;grant select on keryx_storage.identity to service_role;");
  for (const statement of [begin(challenge("sealed")), consume(short), complete(short), `set role service_role;select profile_identities_list_v1('${alice}');`,
    `set role service_role;select profile_identity_unlink_v1('${alice}','github');`]) assert.throws(() => sql(statement), /unavailable in enrolled storage/);
  assert.throws(() => sql(migration), /unavailable in enrolled storage/);
  assert.equal(sql("select jsonb_build_array((select jsonb_agg(l order by wallet,provider) from profile_verified_identities l),(select jsonb_agg(c order by state_hash) from profile_identity_challenges c));"), identityBefore);
  console.log("Verified identity PostgreSQL acceptance passed: actual0085 migration, owner/session/lineage/deadline authority, replay, concurrent identity collision, replacement/unlink/delete invalidation, bounded retention, service-role ACL and sealed refusal.");
} finally {
  for (const child of heldSessions) { child.stdin.end("rollback;\n\\q\n"); child.kill(); }
  if (created) { assert.match(name, /^keryx-profile-identities-[0-9a-f-]{36}$/); docker(["rm", "-f", name]); }
}
