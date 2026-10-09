/** Actual additive0083 SQL in an owned ephemeral PostgreSQL; never application credentials/production. */
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { privateProfileSnapshotSchema, privateProfileRecordSchema } from "../lib/profiles/private-profile.ts";
const name = `keryx-profiles-${randomUUID()}`;
const docker = (args: string[], input?: string) => execFileSync("docker", args, { input, encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
const sqlArgs = ["exec", "-i", name, "psql", "-h", "127.0.0.1", "-U", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"];
const sql = (statement: string) => docker(sqlArgs, statement).trim();
const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const alice = `0x${"a".repeat(40)}`, bob = `0x${"b".repeat(40)}`, creator = `0x${"c".repeat(40)}`;
const input = { displayName: "<script>plain text</script>", handle: "reader_01", bio: "Researcher", purpose: "Read papers", links: [{ kind: "github", url: "https://github.com/alice" }] };
const update = (owner: string, value: unknown) => `set role service_role; select public.private_profile_update_v1('${owner}',${literal(value)});`;
let created = false;
try {
  docker(["info", "--format", "{{.ServerVersion}}"]);
  docker(["run", "-d", "--name", name, "--network", "none", "--memory", "512m", "--cpus", "1", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"]); created = true;
  const deadline = Date.now() + 30000;
  while (true) { try { assert.equal(sql("select 1;"), "1"); break; } catch (cause) { if (Date.now() >= deadline) throw new Error("Owned PostgreSQL startup unavailable", { cause }); await new Promise(resolve => setTimeout(resolve, 100)); } }
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.users(wallet_address text primary key,first_seen_at timestamptz);
    create table public.query_runs(id text primary key,asker text,origin text);
    create table public.query_memories(id text primary key,topics jsonb);
    create table public.payment_events(id text primary key,query_id text,payee text,kind text,network text,settled boolean,settlement_status text,tx_hash text,amount_usdc numeric);
    grant select on public.users,public.query_runs,public.query_memories,public.payment_events to service_role;`);
  sql(readFileSync("supabase/migrations/0083_private_profiles.sql", "utf8"));
  sql(`insert into users values('${alice}','2026-10-08T00:00:00Z');
    insert into query_runs select i::text,'${alice}','web' from generate_series(1,1201) i;
    insert into query_runs values('foreign','${bob}','mcp'),('anonymous',null,'web');
    insert into query_memories values('1','["biology"]');
    insert into payment_events values('settled','1','${creator}','citation','eip155:5042',true,'settled','recorded-circle-id',0.005),
      ('pending','1','${bob}','citation','eip155:5042',false,'pending',null,0.02),
      ('sim','1','${bob}','citation','eip155:5042',false,'simulated',null,0.02),
      ('fee','1','${bob}','operating-fee','eip155:5042',true,'settled','proof',0.02),
      ('old','1','${bob}','citation','eip155:5042002',true,'settled','proof',0.02);`);
  const unchanged = () => sql("select jsonb_build_array((select jsonb_agg(u order by wallet_address) from users u),(select jsonb_agg(r order by id) from query_runs r),(select jsonb_agg(p order by id) from payment_events p));");
  const before = unchanged(), observe = (owner = alice) => privateProfileSnapshotSchema.parse(JSON.parse(sql(`set role service_role;select public.private_profile_get_v1('${owner}','eip155:5042');`)));
  assert.equal(observe().profile, null);
  const first = privateProfileRecordSchema.parse(JSON.parse(sql(update(alice, input))));
  assert.deepEqual(first.links, input.links); assert.equal(first.displayName, input.displayName);
  const edited = privateProfileRecordSchema.parse(JSON.parse(sql(update(alice, { ...input, bio: "Edited" })))); assert.equal(edited.createdAt, first.createdAt);
  assert.deepEqual(observe().activity, { firstSeenAt: "2026-10-08T00:00:00.000Z", questions: 1201, surfacesUsed: ["web"], topics: ["biology"], creatorsPaid: 1, scope: "attributed-current-store", network: "eip155:5042" });
  assert.equal(observe(bob).profile, null);
  for (const handle of ["admin", "Admin", "réader", "0xreader"]) assert.throws(() => sql(update(bob, { ...input, handle })));
  for (const bio of ["line\nline", "line\u2028line", "name\u202Etext", "😀".repeat(81)]) assert.throws(() => sql(update(bob, { ...input, bio })));
  for (const url of ["javascript:alert(1)", "https://github.com.evil.org/alice", "https://github.com:8443/alice", "https://github.com@evil.org/alice", "https://github.com/alice?token=secret", "https://127.0.0.1/alice"]) assert.throws(() => sql(update(bob, { ...input, links: [{ kind: "github", url }] })));
  for (const extra of ["wallet", "questions", "payTo", "visibility"]) assert.throws(() => sql(update(bob, { ...input, [extra]: "forged" })));
  sql(update(bob, { ...input, handle: "existing" }));
  // Separate actual processes/connections contend on the UNIQUE index, never a pre-check race.
  const asyncExec = promisify(execFile);
  const contenders = await Promise.allSettled([alice, bob].map(owner => asyncExec("docker", [...sqlArgs.slice(0, -2), "-v", "ON_ERROR_STOP=1", "-c", update(owner, { ...input, handle: "shared" })], { timeout: 30000, maxBuffer: 1024 * 1024 })));
  assert.equal(contenders.filter(result => result.status === "fulfilled").length, 1); assert.equal(sql("select count(*) from private_profiles where handle='shared';"), "1");
  for (const role of ["anon", "authenticated"]) {
    assert.equal(sql(`select has_table_privilege('${role}','public.private_profiles','SELECT');`), "f");
    assert.throws(() => sql(`set role ${role};select * from public.private_profiles;`));
    for (const signature of ["private_profiles_ordinary_v1(text)", "private_profile_record_v1(text)", "private_profile_get_v1(text,text)", "private_profile_update_v1(text,jsonb)", "private_profile_delete_v1(text)"]) assert.equal(sql(`select has_function_privilege('${role}','public.${signature}','EXECUTE');`), "f");
  }
  sql(`set role service_role;select private_profile_delete_v1('${alice}');select private_profile_delete_v1('${alice}');`); assert.equal(observe().profile, null); assert.equal(unchanged(), before);
  sql("create schema keryx_storage;create table keryx_storage.identity(id integer);insert into keryx_storage.identity values(1);grant usage on schema keryx_storage to service_role;grant select on keryx_storage.identity to service_role;");
  for (const statement of [`select private_profile_get_v1('${alice}','eip155:5042');`, update(alice, input), `select private_profile_delete_v1('${alice}');`, `select private_profile_record_v1('${bob}');`]) assert.throws(() => sql("set role service_role;" + statement), /unavailable in enrolled storage/);
  assert.equal(unchanged(), before);
  console.log("Private profile PostgreSQL acceptance passed: CRUD,1201-row owner aggregate,actual concurrent collision,reserved/URL/field refusal,private ACLs,delete parity,sealed refusal.");
} finally { if (created) { assert.match(name, /^keryx-profiles-[0-9a-f-]{36}$/); docker(["rm", "-f", name]); } }
