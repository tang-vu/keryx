import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

// Only an isolated, disposable PostgreSQL container. No app secrets, host mounts or ports.
const name = `keryx-withdrawal-test-${Date.now()}`;
const binary = process.platform === "win32" ? "wsl.exe" : "docker";
const prefix = process.platform === "win32" ? ["-d", "Ubuntu", "--", "docker"] : [];
const docker = (args: string[], input?: string) => execFileSync(binary, [...prefix, ...args],
  { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const sql = (input: string) => docker(["exec", "-i", name, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A"], input);
const concurrent = (input: string) => new Promise<string>((resolve, reject) => {
  const child = execFile(binary, [...prefix, "exec", "-i", name, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A"],
    { encoding: "utf8" }, (error, stdout) => error ? reject(error) : resolve(stdout));
  child.stdin!.end(`set role service_role; begin; ${input}; select pg_sleep(0.25); commit;`);
});
const id = "'0x'||repeat('1',64)", owner = "'0x'||repeat('2',40)";
const claim = (digit: string) => `select public.claim_creator_withdrawal_transfer(${id},${owner},'${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}')`;
let started = false;
try {
  docker(["run", "-d", "--name", name, "--network", "none", "--memory", "256m", "--cpus", "1",
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17"]); started = true;
  for (let retry = 0; ; retry++) {
    try { docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]); break; }
    catch {
      if (retry === 60) throw new Error("PostgreSQL unavailable");
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  sql("create role anon; create role authenticated; create role service_role bypassrls;\n"
    + readFileSync("supabase/migrations/0062_creator_withdrawal_requests.sql", "utf8"));
  // DB concurrency fixture only. Signature verification is exercised by adapter tests.
  const reserve = `select public.reserve_creator_withdrawal(${id},${owner},jsonb_build_object(
    'id',${id},'owner',${owner},'network','eip155:5042002','format','creator-withdrawal-request-v1'))`;
  await Promise.all([concurrent(reserve), concurrent(reserve)]);
  assert.equal(sql("select count(*) from public.creator_withdrawal_requests").trim(), "1");
  assert.equal(sql(`set role service_role; select public.claim_creator_withdrawal_transfer(${id},'0x'||repeat('9',40),'99999999-9999-4999-8999-999999999999')`).trim().split(/\s+/).at(-1), "f");
  const flags = (await Promise.all([concurrent(claim("3")), concurrent(claim("4"))]))
    .flatMap(value => value.split(/\s+/).filter(part => part === "t" || part === "f")).sort();
  assert.deepEqual(flags, ["f", "t"]);
  const original = sql(`select claim_id,started_at from public.creator_withdrawal_transfer_attempts where id=${id}`).trim();
  assert.equal((await concurrent(claim("5"))).split(/\s+/).filter(part => part === "t" || part === "f").join(), "f");
  assert.equal(sql(`select claim_id,started_at from public.creator_withdrawal_transfer_attempts where id=${id}`).trim(), original);
  sql(`set role service_role; do $$ begin
    begin update public.creator_withdrawal_requests set owner=owner; raise exception 'request update allowed'; exception when insufficient_privilege then null; end;
    begin delete from public.creator_withdrawal_requests; raise exception 'request delete allowed'; exception when insufficient_privilege then null; end;
    begin update public.creator_withdrawal_transfer_attempts set claim_id=claim_id; raise exception 'claim update allowed'; exception when insufficient_privilege then null; end;
    begin delete from public.creator_withdrawal_transfer_attempts; raise exception 'claim delete allowed'; exception when insufficient_privilege then null; end;
  end $$; reset role;
  do $$ declare role_name text; begin
    foreach role_name in array array['anon','authenticated'] loop
      if has_table_privilege(role_name,'public.creator_withdrawal_requests','select')
        or has_table_privilege(role_name,'public.creator_withdrawal_transfer_attempts','select')
        or has_function_privilege(role_name,'public.reserve_creator_withdrawal(text,text,jsonb)','execute')
        or has_function_privilege(role_name,'public.claim_creator_withdrawal_transfer(text,text,uuid)','execute')
      then raise exception 'public withdrawal journal authority'; end if;
    end loop;
  end $$;`);
  console.log("PASS: PostgreSQL 17 duplicate request and competing claim admission, retained original attempt, foreign-owner denial and private service permissions. Synthetic database fixture only; no signing or transfers.");
} finally { if (started) docker(["rm", "-f", name]); }
