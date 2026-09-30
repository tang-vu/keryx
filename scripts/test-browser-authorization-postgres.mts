import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

// Disposable PostgreSQL only: no app environment, published ports, mounts or network.
const name = `keryx-browser-admission-test-${Date.now()}`;
const binary = process.platform === "win32" ? "wsl.exe" : "docker";
const prefix = process.platform === "win32" ? ["-d", "Ubuntu", "--", "docker"] : [];
const docker = (args: string[], input?: string) => execFileSync(binary, [...prefix, ...args],
  { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const psql = ["exec", "-i", name, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"];
const sql = (input: string) => docker(psql, input).trim();
const concurrent = (input: string) => new Promise<string>((resolve, reject) => {
  const child = execFile(binary, [...prefix, ...psql], { encoding: "utf8" },
    (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  child.stdin!.end(`set role service_role; begin; ${input}; select pg_sleep(0.1); commit;`);
});
const signer = `0x${"a".repeat(40)}`;
const nonce = (id: number) => `0x${id.toString(16).padStart(64, "0")}`;
const intent = (id: number, overrides: Record<string, unknown> = {}) => ({
  nonce: nonce(id), session_id: "owner", request_id: `request-${id}`, query_id: "query",
  grant_epoch: "epoch-1", signer, network: "eip155:5042002",
  token: "0x3600000000000000000000000000000000000000",
  gateway_contract: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  source_id: "synthetic-source", offer_id: null, kind: "fetch",
  payee: `0x${"2".repeat(40)}`, amount_micro_usdc: "1",
  created_at: "2026-09-30T00:00:00Z", ...overrides,
});
const admit = (id: number, overrides: Record<string, unknown> = {}) =>
  `select public.admit_browser_authorization('${JSON.stringify(intent(id, overrides)).replaceAll("'", "''")}'::jsonb)`;
const asService = (input: string) => sql(`set role service_role; ${input};`);
const state = () => sql(`select spent * 1000000, (select count(*) from public.browser_authorization_intents)
  from public.session_grants where session_id='owner'`);
async function ready() {
  for (let retry = 0; ; retry++) {
    try { docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]); return; }
    catch {
      if (retry === 60) throw new Error("PostgreSQL unavailable");
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}
let started = false;
try {
  // Fail rather than skip when Docker is unavailable; CI is the runtime gate.
  docker(["info", "--format", "{{.ServerVersion}}"]);
  docker(["run", "-d", "--name", name, "--network", "none", "--memory", "256m", "--cpus", "1",
    "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17"]);
  started = true;
  await ready();
  // Apply the actual complete migration chain through D-268, including real grants/RLS.
  const migrations = readdirSync("supabase/migrations")
    .filter(file => /^\d{4}.*\.sql$/.test(file) && Number(file.slice(0, 4)) <= 67).sort();
  assert(migrations.includes("0067_browser_authorization_admission.sql"));
  // Supabase supplies these roles and its realtime publication, not application functions.
  sql("create role anon; create role authenticated; create role service_role bypassrls; create publication supabase_realtime;\n" +
    migrations.map(file => readFileSync(`supabase/migrations/${file}`, "utf8")).join("\n"));
  asService(`insert into public.session_grants(session_id,sess_addr,owner_addr,cap,spent,expiry,tx_hash,grant_epoch)
    values ('owner','${signer}','synthetic-owner',0.000002,0,
      (extract(epoch from clock_timestamp())*1000)::bigint + 3600000,'synthetic-unfunded','epoch-1')`);
  const results = await Promise.allSettled([1, 2, 3].map(id => concurrent(admit(id))));
  const outcomes = results.map(result => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  }).sort();
  assert.deepEqual(outcomes, ["admitted", "admitted", "grant_or_cap_refused"]);
  assert.equal(sql("select spent=0.000002 from public.session_grants where session_id='owner'"), "t");
  assert.equal(sql("select count(*) from public.browser_authorization_intents"), "2");
  asService("update public.session_grants set cap=0.000010 where session_id='owner'");
  const original = JSON.parse(sql("select row_to_json(i) from public.browser_authorization_intents i order by nonce limit 1"));
  const before = state();
  assert.throws(() => asService(admit(10, { request_id: original.request_id })), /unique constraint/);
  assert.equal(state(), before, "duplicate request must roll back spend");
  assert.throws(() => asService(admit(11, { nonce: original.nonce })), /unique constraint/);
  assert.equal(state(), before, "duplicate nonce must roll back spend");
  sql(`create function public.synthetic_fail_browser_insert() returns trigger language plpgsql as $$
    begin raise exception 'synthetic forced insert failure'; end $$;
    create trigger synthetic_fail_insert before insert on public.browser_authorization_intents
      for each row execute function public.synthetic_fail_browser_insert()`);
  assert.throws(() => asService(admit(12)), /synthetic forced insert failure/);
  assert.equal(state(), before, "insert error must roll back spend");
  sql("drop trigger synthetic_fail_insert on public.browser_authorization_intents; drop function public.synthetic_fail_browser_insert()");
  for (const override of [{ grant_epoch: "replaced" }, { signer: `0x${"9".repeat(40)}` }, { session_id: "foreign" }]) {
    assert.equal(asService(admit(20, override)), "grant_or_cap_refused");
    assert.equal(state(), before);
  }
  asService("update public.session_grants set expiry=0 where session_id='owner'");
  assert.equal(asService(admit(21)), "grant_or_cap_refused");
  assert.equal(state(), before);
  asService(`update public.session_grants set expiry=(extract(epoch from clock_timestamp())*1000)::bigint+3600000,
    cap=0.0000101 where session_id='owner'`);
  assert.equal(asService(admit(22)), "grant_or_cap_refused");
  assert.equal(state(), before, "fractional legacy cap must not be rounded");
  asService("update public.session_grants set cap=0.000010,spent=0.0000021 where session_id='owner'");
  const fractional = state();
  assert.equal(asService(admit(23)), "grant_or_cap_refused");
  assert.equal(state(), fractional, "fractional legacy spend must not be rounded");
  asService("update public.session_grants set spent=0.000002 where session_id='owner'");
  for (const override of [{ amount_micro_usdc: "0" }, { amount_micro_usdc: "1.1" },
    { amount_micro_usdc: "9007199254740992" }, { network: "eip155:1" }, { kind: "other" },
    { token: `0x${"3".repeat(40)}` }, { gateway_contract: `0x${"3".repeat(40)}` }]) {
    assert.throws(() => asService(admit(24, override)), /Invalid browser authorization/);
    assert.equal(state(), before);
  }
  // Successful service_role admission demonstrates invoker table privileges too.
  assert.equal(asService(admit(30, { signer: signer.toUpperCase().replace("0X", "0x") })), "admitted");
  for (const role of ["anon", "authenticated"]) {
    assert.throws(() => sql(`set role ${role}; ${admit(40)}`), /permission denied/);
    for (const statement of ["select * from public.browser_authorization_intents",
      "select * from public.session_grants", "update public.browser_authorization_intents set payee=payee",
      "delete from public.browser_authorization_intents"]) {
      assert.throws(() => sql(`set role ${role}; ${statement}`), /permission denied/);
    }
    assert.equal(sql(`select has_table_privilege('${role}','public.browser_authorization_intents','insert')
      or has_function_privilege('${role}','public.admit_browser_authorization(jsonb)','execute')`), "f");
  }
  assert.equal(sql(`select relrowsecurity from pg_class where oid='public.browser_authorization_intents'::regclass`), "t");
  for (const statement of ["update public.browser_authorization_intents set payee=payee", "delete from public.browser_authorization_intents"]) {
    assert.throws(() => asService(statement), /permission denied/);
    assert.throws(() => sql(statement), /browser authorization intent is immutable/);
  }
  for (const calls of [
    [admit(50, { request_id: "competing-request" }), admit(51, { request_id: "competing-request" })],
    [admit(52, { nonce: nonce(54) }), admit(53, { nonce: nonce(54) })],
  ]) {
    const spentBefore = Number(sql("select spent*1000000 from public.session_grants where session_id='owner'"));
    const raced = await Promise.allSettled(calls.map(concurrent));
    assert.equal(raced.filter(result => result.status === "fulfilled" && result.value === "admitted").length, 1);
    assert.equal(raced.filter(result => result.status === "rejected" && /unique constraint/.test(String(result.reason))).length, 1);
    assert.equal(Number(sql("select spent*1000000 from public.session_grants where session_id='owner'")), spentBefore + 1,
      "competing duplicate must reserve once");
  }
  const snapshot = sql(`select jsonb_agg(to_jsonb(i) order by nonce) from public.browser_authorization_intents i`);
  const persisted = state();
  docker(["restart", name]);
  await ready();
  assert.equal(state(), persisted, "committed spend and intent count must survive restart");
  assert.equal(sql(`select jsonb_agg(to_jsonb(i) order by nonce) from public.browser_authorization_intents i`), snapshot);
  assert.throws(() => asService(admit(30)), /unique constraint/);
  assert.equal(state(), persisted, "restart replay must not reserve twice");
  console.log("PASS: PostgreSQL 17 real migrations, service-role admission, concurrent last-micro cap, duplicate/insert rollback, grant fences, exact legacy refusal, restricted roles, immutable intents and restart persistence. Synthetic unfunded data only; no signing or settlement. Restart does not prove power-loss durability.");
} finally { if (started) docker(["rm", "-f", "-v", name]); }
