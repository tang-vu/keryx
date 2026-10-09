/** Real SQL against an owned, network-none synthetic PostgreSQL container. No app credentials or host ports. */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const name = `keryx-history-${randomUUID()}`, owner = `0x${"a".repeat(40)}`, other = `0x${"b".repeat(40)}`;
const docker = (args: string[], input?: string) => execFileSync("docker", args, { input, encoding: "utf8", timeout: 30000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
const sql = (input: string) => docker(["exec", "-i", name, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], input).trim();
const call = (filters = "{}", take = 2, before = "null", upper = "null", role = "service_role") => sql(`set role ${role}; select public.personal_history_read_v1('${owner}','${filters}'::jsonb,${take},${upper}::jsonb,${before}::jsonb);`).split("\n").at(-1)!;
let created = false;
try {
  docker(["run", "-d", "--name", name, "--network", "none", "--memory", "512m", "--cpus", "1", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"]); created = true;
  for (let attempt = 0; ; attempt++) {
    try { sql("select 1;"); break; } catch (error) { if (attempt >= 30) throw error; await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  sql(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.query_runs(id text primary key,created_at timestamptz,question text,asker text,total_spent numeric,total_to_creators numeric,payment_mode text,parent_id text,data jsonb);
    grant select on public.query_runs to service_role;
    insert into query_runs select id,'2026-10-09T12:00:00.000Z','Question %_ literal','${owner}',0.1,0.04,'offline',null,
      jsonb_build_object('asker','${owner}','answer','private-original-not-returned','askerFunded',id='d','provenance',
        case when id='d' then '{"version":1,"surface":"web","ownershipMethod":"session"}'::jsonb else null end)
      from (values('a'),('b'),('c'),('d')) ids(id);
    insert into query_runs values('foreign','2026-10-10','Foreign','${other}',0,0,'offline',null,'{}'),('ownerless','2026-10-10','Ownerless',null,0,0,'offline',null,'{}');`);
  sql(readFileSync(resolve("supabase/migrations/0084_personal_history_read.sql"), "utf8"));
  const beforeBytes = sql("select md5(string_agg(row_to_json(q)::text,'' order by id)) from query_runs q;");
  const first = JSON.parse(call()); assert.deepEqual(first.rows.map((r: { id: string }) => r.id), ["d", "c"]); assert.equal(first.wallet, owner);
  assert(!JSON.stringify(first).includes("private-original"));
  const next = JSON.parse(call("{}", 2, `'${JSON.stringify({ createdAt: "2026-10-09T12:00:00.000Z", id: "c" })}'`, `'${JSON.stringify({ createdAt: "2026-10-09T12:00:00.000Z", id: "d" })}'`));
  assert.deepEqual(next.rows.map((r: { id: string }) => r.id), ["b", "a"]);
  assert.equal(JSON.parse(call('{"search":"question"}')).rows.length, 0);
  assert.deepEqual(JSON.parse(call('{"search":"%_","surface":"web","funding":"browser-recorded"}')).rows.map((r: { id: string }) => r.id), ["d"]);
  assert.equal(JSON.parse(call('{"surface":"unknown","funding":"other-or-unknown"}', 50)).rows.length, 3);
  for (const filters of ['{"wallet":"other"}', '{"surface":"spoof"}', '{"from":"2026-02-30T00:00:00.000Z"}', '{"from":"2026-10-10T00:00:00.000Z","to":"2026-10-09T00:00:00.000Z"}']) assert.throws(() => call(filters));
  assert.throws(() => call("{}", 52)); for (const role of ["anon", "authenticated"]) assert.throws(() => call("{}", 2, "null", "null", role));
  assert.equal(sql("select md5(string_agg(row_to_json(q)::text,'' order by id)) from query_runs q;"), beforeBytes);
  sql("create schema keryx_storage; create table keryx_storage.identity(id integer); insert into keryx_storage.identity values(1); grant usage on schema keryx_storage to service_role; grant select on keryx_storage.identity to service_role;");
  assert.throws(() => call()); assert.throws(() => sql(readFileSync(resolve("supabase/migrations/0084_personal_history_read.sql"), "utf8")));
  console.log("Personal history real PostgreSQL ownership/filter/keyset/ACL/immutability/enrolled refusal passed.");
} finally {
  if (created) { if (!/^keryx-history-[0-9a-f-]{36}$/.test(name)) throw new Error("Refuse non-owned cleanup"); docker(["rm", "-f", name]); }
}
