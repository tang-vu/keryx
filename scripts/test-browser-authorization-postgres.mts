import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { browserPostgresFixture } from "../test-support/browser-postgres-fixture";
import { postgresBrowserMigrationProfiles } from "../test-support/postgres-browser-migration-profiles";

// Disposable PostgreSQL only: no app environment, published ports, mounts or network.
const postgres = browserPostgresFixture(process.argv.slice(2));
const sql = postgres.sql;
const concurrent = (input: string) => new Promise<string>((resolve, reject) => {
  const child = postgres.spawnClient(); let output = "", errors = "";
  child.stdout.on("data", chunk => { output += String(chunk); });
  child.stderr.on("data", chunk => { errors = (errors + String(chunk)).slice(-4096); });
  child.once("error", reject);
  child.once("close", code => code === 0 ? resolve(output.trim()) : reject(new Error(`Synthetic PostgreSQL client failed: ${errors}`)));
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
const state = () => sql(`select trim_scale(spent * 1000000), (select count(*) from public.browser_authorization_intents)
  from public.session_grants where session_id='owner'`);
const json = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const grant = (epoch: string, session = "owner", address = signer, capMicro = 100) =>
  `select public.upsert_browser_journal_grant(${json({ session_id: session, sess_addr: address,
    owner_addr: "synthetic-owner", cap: capMicro / 1e6, expiry: Date.now() + 3600000,
    tx_hash: "synthetic-unfunded", grant_epoch: epoch })})`;
const journalTuple = (id: number, overrides: Record<string, unknown> = {}) => {
  const i = intent(id, { grant_epoch: "journal-owner", ...overrides });
  const r = { scheme: "exact", network: i.network, asset: i.token, payTo: i.payee,
    amount: String(i.amount_micro_usdc), maxTimeoutSeconds: 604900,
    extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: i.gateway_contract } };
  const p = { kind: i.kind, queryId: i.query_id, sourceId: i.source_id, sourceName: "Synthetic",
    payer: i.signer, payee: i.payee, amountUsdc: Number(i.amount_micro_usdc) / 1e6,
    network: i.network, grantEpoch: i.grant_epoch, offerId: i.offer_id, origin: "web" };
  return { i, r, p };
};
const journal = (id: number, overrides: Record<string, unknown> = {}) => {
  const { i, r, p } = journalTuple(id, overrides);
  return `select public.admit_browser_journal(${json(i)},${json(r)},${json(p)})`;
};
const transition = (id: number, from: string | null, to: string | null, session = "owner") =>
  `select public.transition_browser_journal('${session}','request-${id}',${from === null ? "null" : `'${from}'`},${to === null ? "null" : `'${to}'`})`;
const terminal = (id: number, mode: string, proof: string | null = "synthetic-circle-terminal") =>
  `select public.terminal_browser_journal('x402:${nonce(id)}','${nonce(id)}',${proof === null ? "null" : `'${proof}'`},'${mode}')`;
const signedMetadata = { validAfter: "0", validBefore: "2000000000", headerHash: "f".repeat(64) };
const sign = (id: number, metadata = signedMetadata) =>
  `select public.sign_browser_journal('owner','request-${id}',${json(metadata)})`;
const journalState = () => sql(`select jsonb_build_object(
  'grants',(select jsonb_agg(to_jsonb(g) order by session_id) from public.session_grants g),
  'capacity',(select jsonb_agg(to_jsonb(c) order by signer) from public.browser_signer_capacity c),
  'retained',(select jsonb_agg(to_jsonb(r) order by grant_epoch) from public.browser_retained_grants r),
  'intents',(select jsonb_agg(to_jsonb(i) order by nonce) from public.browser_authorization_intents i),
  'bindings',(select jsonb_agg(to_jsonb(b) order by nonce) from public.browser_journal_bindings b),
  'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.payment_events p))`);
try {
  // Fail rather than skip when Docker is unavailable; CI is the runtime gate.
  await postgres.start();
  // Seed/test the previous writer before applying cutover. Both chains are actual migrations.
  const profiles = postgresBrowserMigrationProfiles(readdirSync("supabase/migrations"));
  const migrations = profiles.native;
  assert(migrations.includes("0067_browser_authorization_admission.sql"));
  assert(migrations.includes("0068_browser_authorization_timestamp.sql"));
  assert(migrations.includes("0069_browser_authorization_journal.sql"));
  // Supabase supplies these roles and its realtime publication, not application functions.
  sql("create role anon; create role authenticated; create role service_role bypassrls; create publication supabase_realtime;\n" +
    migrations.filter(file => Number(file.slice(0, 4)) < 69)
      .map(file => readFileSync(`supabase/migrations/${file}`, "utf8")).join("\n"));
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
  assert.equal(sql(`select bool_and(created_at='2026-09-30T00:00:00Z'::timestamptz)
    from public.browser_authorization_intents`), "t", "admission must persist the supplied timestamp");
  asService("update public.session_grants set cap=0.000010 where session_id='owner'");
  const original = JSON.parse(sql("select row_to_json(i) from public.browser_authorization_intents i order by nonce limit 1"));
  const before = state();
  assert.throws(() => asService(admit(9, { created_at: "synthetic-invalid-timestamp" })), /invalid input syntax.*timestamp/);
  assert.equal(state(), before, "invalid timestamp must roll back spend and intent insert");
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
  // Legacy current-epoch evidence overlaps already held spend; orphan epochs must
  // survive grant replacement. Failed/simulated rows do not consume retained cap.
  asService(`insert into public.payment_events(id,kind,query_id,source_id,payer,payee,amount_usdc,network,
    settled,settlement_status,authorization_id,grant_epoch,tx_hash) values
    ('legacy-current','fetch','query','synthetic-source','${signer}','${`0x${"2".repeat(40)}`}',0.000001,'eip155:5042002',false,'pending','${nonce(100)}','epoch-1',null),
    ('legacy-orphan-pending','fetch','query','synthetic-source','${signer}','${`0x${"2".repeat(40)}`}',0.000001,'eip155:5042002',false,'pending','${nonce(101)}','orphan-epoch',null),
    ('legacy-orphan-settled','fetch','query','synthetic-source','${signer}','${`0x${"2".repeat(40)}`}',0.000001,'eip155:5042002',true,'settled','${nonce(102)}','orphan-epoch','synthetic-settlement'),
    ('legacy-simulated','fetch','query','synthetic-source','${signer}','${`0x${"2".repeat(40)}`}',1,'eip155:5042002',false,'simulated',null,'ignored-epoch',null)`);
  const legacySpent = Number(sql("select spent*1000000 from public.session_grants where session_id='owner'"));
  asService(`insert into public.session_grants(session_id,sess_addr,owner_addr,cap,spent,expiry,tx_hash,grant_epoch)
    values('legacy-cap-alias','${signer.toUpperCase().replace("0X", "0x")}','synthetic-owner',0.000001,0,0,'synthetic-unfunded','legacy-alias-epoch')`);
  // Hosted projects may grant service-role DML through default ACLs. Migration
  // restrictions must override those defaults explicitly, not assume a clean cluster.
  sql("alter default privileges in schema public grant all on tables to service_role");
  sql(migrations.filter(file => Number(file.slice(0, 4)) >= 69)
    .map(file => readFileSync(`supabase/migrations/${file}`, "utf8")).join("\n"));
  // Actively prove ordinary extensions refuse the native marker rather than silently omit them.
  const nativeSchema = () => sql("select coalesce(jsonb_agg(c.relname order by c.relname)::text,'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','keryx_storage');");
  for (const extension of profiles.extensions) {
    const before = nativeSchema();
    assert.throws(() => sql(readFileSync(`supabase/migrations/${extension.file}`, "utf8")), new RegExp(extension.refusal));
    assert.equal(nativeSchema(), before, "Native refusal must leave relations unchanged");
  }
  const ordinary = `browser_ordinary_${randomUUID().replaceAll("-", "")}`;
  postgres.createDatabase(ordinary);
  postgres.sql("create publication supabase_realtime;\n" + profiles.ordinary.concat(profiles.extensions.map(extension => extension.file))
    .map(file => readFileSync(`supabase/migrations/${file}`, "utf8")).join("\n"), ordinary);
  assert.equal(postgres.sql("select to_regclass('keryx_storage.identity') is null;", ordinary), "t");
  for (const extension of profiles.extensions) {
    if (extension.file === "0086_decision_reviews.sql") {
      assert.deepEqual(JSON.parse(postgres.sql("set role service_role;select public.decision_reviews_v1('ready',null,'{}'::jsonb);", ordinary)), { ready: true });
      assert.throws(() => postgres.sql("set role anon;select public.decision_reviews_v1('ready',null,'{}'::jsonb);", ordinary), /permission denied/);
    } else {
      assert.equal(postgres.sql("select to_regclass('public.deliverable_acceptance_entries') is not null;", ordinary), "t");
      assert.throws(() => postgres.sql("set role anon;select * from public.deliverable_acceptance_entries;", ordinary), /permission denied/);
    }
  }
  console.log(`PASS actual migration profiles: ${migrations.length} accepted native inputs preserved; ${profiles.extensions.map(extension => extension.file).join(', ')} refuse native and install separately on fresh ordinary storage`);
  assert.equal(sql("select active from public.browser_journal_control"), "f", "schema must not activate signing");
  assert.equal(asService(journal(200)), "inactive");
  asService(`insert into public.session_grants(session_id,sess_addr,owner_addr,cap,spent,expiry,tx_hash,grant_epoch)
    values('revoke-legacy','${signer}','synthetic-owner',0.0001,0,${Date.now()+60000},'synthetic-unfunded','legacy-current')`);
  assert.equal(asService(`select public.revoke_session_grant('revoke-legacy','legacy-old','${signer}')`), "f");
  assert.equal(sql("select grant_epoch from public.session_grants where session_id='revoke-legacy'"), "legacy-current");
  assert.equal(asService(`select public.revoke_session_grant('revoke-legacy','legacy-current','${signer}')`), "t");
  assert.equal(sql("select count(*) from public.session_grants where session_id='revoke-legacy'"), "0");
  asService("update public.session_grants set spent=spent+0.0000001 where session_id='owner'");
  assert.throws(() => asService("select public.activate_browser_journal()"), /exact capacity audit/);
  assert.equal(sql("select active from public.browser_journal_control"), "f");
  assert.equal(sql("select count(*) from public.browser_retained_grants"), "0", "activation failure must be atomic");
  asService(`update public.session_grants set spent=${legacySpent}/1000000.0 where session_id='owner'`);
  asService("select public.activate_browser_journal()");
  asService("select public.activate_browser_journal()");
  assert.equal(sql(`select spent_micro from public.browser_signer_capacity where signer='${signer}'`), String(legacySpent + 2));
  assert.equal(sql(`select bool_and(g.spent*1000000=c.spent_micro)
    from public.session_grants g join public.browser_signer_capacity c on lower(g.sess_addr)=c.signer`), "t",
  "activation must synchronize all current aliases with imported orphan-epoch capacity");
  assert.equal(sql("select cap=0.000001 and spent>cap from public.session_grants where session_id='legacy-cap-alias'"), "t",
    "retained consumption may exhaust a smaller alias; activation must preserve its cap");
  assert.equal(sql("select spent_micro from public.browser_retained_grants where grant_epoch='orphan-epoch'"), "2");
  assert.equal(sql("select count(*) from public.browser_retained_grants where grant_epoch='ignored-epoch'"), "0");
  assert.equal(sql("select bool_and(authorization_phase is null) from public.payment_events"), "t", "legacy phases must remain unknown");

  const oldWriters = [
    "update public.session_grants set spent=0 where session_id='owner'",
    "delete from public.session_grants where session_id='owner'",
    `insert into public.session_grants select 'old-alias',sess_addr,owner_addr,cap,0,expiry,tx_hash,'old-alias-epoch' from public.session_grants where session_id='owner'`,
    `select public.reserve_session_grant_spend('owner','epoch-1','${signer}',0.000001,0)`,
    `select public.release_session_grant_spend('owner','epoch-1','${signer}',0.000001)`,
    admit(201),
    `select public.fail_pending_payment('legacy-current','${nonce(100)}','synthetic-terminal')`,
    "update public.payment_events set settled=true,settlement_status='settled' where id='legacy-current'",
    "delete from public.payment_events where id='legacy-current'",
  ];
  const activeState = journalState();
  for (const statement of oldWriters) {
    assert.throws(() => asService(statement), /browser journal writer required|payment is retained/);
    assert.equal(journalState(), activeState, "old writer must leave financial state untouched");
  }
  assert.throws(() => asService("insert into public.browser_journal_writer values(txid_current())"), /permission denied/);
  assert.throws(() => asService("update public.browser_journal_control set active=false"), /permission denied/);
  assert.throws(() => asService("update public.browser_signer_capacity set spent_micro=0"), /permission denied/);
  assert.throws(() => asService("update public.browser_retained_grants set spent_micro=0"), /permission denied/);
  assert.throws(() => asService("insert into public.browser_journal_bindings values('fake','{}','{}',null,null,null)"), /permission denied/);
  assert.throws(() => asService(`select public.release_browser_journal_capacity('epoch-1','${signer}',1)`), /permission denied/);
  assert.throws(() => asService("select set_config('keryx.browser_journal_writer','v1',true); update public.session_grants set spent=0"), /browser journal writer required/);
  assert.equal(sql("select count(*) from public.browser_journal_writer"), "0");
  asService(`insert into public.payment_events(id,kind,query_id,source_id,payer,payee,amount_usdc,network,settled,settlement_status)
    values('synthetic-treasury-delete','fetch','query','synthetic-source','${signer}','${`0x${"2".repeat(40)}`}',0.000001,'eip155:5042002',false,'pending')`);
  asService("delete from public.payment_events where id='synthetic-treasury-delete'");

  asService(grant("journal-owner", "owner", signer, legacySpent + 4));
  const lastMicros = await Promise.allSettled([210, 211, 212].map(id => concurrent(journal(id))));
  assert.deepEqual(lastMicros.map(result => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  }).sort(), ["admitted", "admitted", "grant_or_cap_refused"]);
  assert.equal(sql("select count(*) from public.payment_events where authorization_phase='prepared'"), "2");
  assert.equal(sql(`select count(*) from public.browser_journal_bindings b join public.browser_authorization_intents i using(nonce)
    join public.payment_events p on p.id='x402:'||i.nonce where p.authorization_phase='prepared'`), "2", "reserve + intent + authority must be bridged");
  for (const role of ["anon", "authenticated"]) {
    assert.equal(sql(`set role ${role}; select count(*) from public.payment_events where authorization_phase='prepared'`), "0", "RLS must hide prepared nonces");
    for (const call of [journal(220), "select public.activate_browser_journal()", grant("foreign"),
      transition(210, "prepared", "exposed"), sign(210), terminal(210, "failed"),
      "select public.get_browser_journal('owner','request-210')", `select public.browser_signer_confirmed_spend_micro('${signer}')`])
      assert.throws(() => sql(`set role ${role}; ${call}`), /permission denied/);
    for (const table of ["browser_journal_control", "browser_journal_writer", "browser_signer_capacity", "browser_retained_grants", "browser_journal_bindings", "browser_authorization_intents"])
      assert.throws(() => sql(`set role ${role}; select * from public.${table}`), /permission denied/);
  }
  // Revoke retains every hold. Recovery/owner changes and session aliases share signer capacity.
  asService("select public.disable_browser_journal_grant('owner')");
  assert.equal(asService(journal(221)), "grant_or_cap_refused");
  assert.throws(() => asService(grant("too-small", "owner", signer, 1)), /cannot reset retained/);
  asService(grant("owner-recovered", "owner", signer, 100));
  assert.equal(sql(`select spent*1000000=spent_micro and spent*1000000=${legacySpent + 4}
    and spent*1000000=trunc(spent*1000000)
    from public.session_grants join public.browser_signer_capacity on lower(sess_addr)=signer where session_id='owner'`), "t",
    "recovered grant must report exact retained signer consumption");
  const heldIds = [210, 211, 212].filter(id => sql(`select count(*) from public.payment_events where id='x402:${nonce(id)}'`) === "1");
  assert.equal(asService(terminal(heldIds[0], "cancelled_unexposed", null)).includes('"resolved": true'), true);
  assert.equal(JSON.parse(asService(terminal(heldIds[0], "cancelled_unexposed", null))).resolved, false);
  const hold = heldIds[1];
  assert.equal(asService(transition(hold, "prepared", "exposed")), "t");
  const exposedState = journalState();
  assert.equal(JSON.parse(asService(terminal(hold, "cancelled_unexposed", null))).resolved, false);
  assert.equal(journalState(), exposedState, "exposed cancellation must not free capacity");
  assert.equal(asService(sign(hold)), "t", "signature persists even after grant epoch replacement");
  assert.equal(asService(sign(hold)), "t", "identical callback is idempotent");
  assert.equal(asService(sign(hold, { ...signedMetadata, headerHash: "e".repeat(64) })), "f");
  assert.equal(asService(transition(hold, "signed", "submission_attempted")), "t");
  assert.equal(asService(transition(hold, "signed", "submission_attempted")), "f");
  assert.throws(() => asService(transition(hold, null, "exposed")), /Invalid journal transition/);
  assert.throws(() => asService(terminal(hold, "failed", null)), /proof identifier required/);
  const signedRow = JSON.parse(asService(`select public.get_browser_journal('owner','request-${hold}')`));
  assert.equal(signedRow.payment.authorization_phase, "submission_attempted");
  assert.equal(signedRow.binding.header_hash, signedMetadata.headerHash);
  assert.equal(signedRow.payment.authorization_expires_at, "2033-05-18T03:33:20+00:00");
  const capBeforeFailure = Number(sql(`select spent_micro from public.browser_signer_capacity where signer='${signer}'`));
  assert.deepEqual(JSON.parse(asService(terminal(hold, "failed"))), { resolved: true, reservation_released: true });
  assert.equal(Number(sql(`select spent_micro from public.browser_signer_capacity where signer='${signer}'`)), capBeforeFailure - 1);
  assert.equal(sql("select spent_micro from public.browser_retained_grants where grant_epoch='journal-owner'"), "0");
  assert.equal(JSON.parse(asService(terminal(hold, "failed"))).resolved, false);
  assert.equal(JSON.parse(asService(`select public.terminal_browser_journal('legacy-orphan-pending','${nonce(101)}','synthetic-legacy-failure','failed')`)).reservation_released, true);
  assert.equal(sql("select spent_micro from public.browser_retained_grants where grant_epoch='orphan-epoch'"), "1");

  // Insert/duplicate failures occur after capability issuance; rollback removes every side effect.
  const rollbackState = journalState();
  sql(`create function public.synthetic_fail_browser_payment() returns trigger language plpgsql as $$
    begin if new.authorization_phase='prepared' then raise exception 'synthetic payment insert failure'; end if; return new; end $$;
    create trigger synthetic_fail_payment before insert on public.payment_events for each row execute function public.synthetic_fail_browser_payment()`);
  assert.throws(() => asService(journal(230, { grant_epoch: "owner-recovered" })), /synthetic payment insert failure/);
  assert.equal(journalState(), rollbackState);
  assert.equal(sql("select count(*) from public.browser_journal_writer"), "0");
  sql("drop trigger synthetic_fail_payment on public.payment_events; drop function public.synthetic_fail_browser_payment()");
  assert.equal(asService(journal(231, { grant_epoch: "owner-recovered" })), "admitted");
  const admittedState = journalState();
  assert.throws(() => asService(journal(232, { grant_epoch: "owner-recovered", request_id: "request-231" })), /unique constraint/);
  assert.throws(() => asService(journal(233, { grant_epoch: "owner-recovered", nonce: nonce(231) })), /nonce collision/);
  assert.equal(journalState(), admittedState);
  for (const change of [{ asset: null }, { scheme: null }, { maxTimeoutSeconds: null },
    { extra: { name: null, version: "1", verifyingContract: intent(1).gateway_contract } }]) {
    const t = journalTuple(240, { grant_epoch: "owner-recovered" });
    assert.throws(() => asService(`select public.admit_browser_journal(${json(t.i)},${json({ ...t.r, ...change })},${json(t.p)})`), /economic tuple/);
    assert.equal(journalState(), admittedState, "NULL challenge fields must fail closed");
  }
  assert.throws(() => asService(`insert into public.payment_events(id,kind,query_id,source_id,payer,payee,amount_usdc,network,settled,settlement_status,authorization_id)
    select 'alternate-null-phase',kind,query_id,source_id,payer,payee,amount_usdc,network,false,'pending',authorization_id
    from public.payment_events where id='x402:${nonce(231)}'`), /nonce collision/);
  assert.throws(() => asService(`update public.payment_events set amount_usdc=amount_usdc+0.000001 where id='x402:${nonce(231)}'`), /writer required/);
  assert.equal(journalState(), admittedState);
  // Capability must disappear before RPC return, even inside an explicit caller transaction.
  assert.throws(() => asService(`begin; ${transition(231, "prepared", "exposed")}; update public.session_grants set spent=0; commit`), /writer required/);
  assert.equal(journalState(), admittedState, "caller transaction failure rolls back exposure too");
  assert.equal(sql("select count(*) from public.browser_journal_writer"), "0");
  assert.equal(asService(transition(231, "prepared", "exposed")), "t");
  assert.equal(asService(sign(231)), "t");
  const settleSpent = sql(`select spent_micro from public.browser_signer_capacity where signer='${signer}'`);
  assert.deepEqual(JSON.parse(asService(terminal(231, "settled"))), { resolved: true, reservation_released: false });
  assert.equal(sql(`select spent_micro from public.browser_signer_capacity where signer='${signer}'`), settleSpent, "settled debit remains consumed");

  const otherSigner = `0x${"b".repeat(40)}`;
  asService(grant("alias-a", "alias-a", otherSigner, 2));
  asService(grant("alias-b", "alias-b", otherSigner.toUpperCase().replace("0X", "0x"), 2));
  const aliasCalls = [250, 251, 252].map((id, n) => journal(id, { signer: otherSigner,
    session_id: n % 2 ? "alias-b" : "alias-a", grant_epoch: n % 2 ? "alias-b" : "alias-a" }));
  const aliases = await Promise.allSettled(aliasCalls.map(concurrent));
  assert.deepEqual(aliases.map(result => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  }).sort(), ["admitted", "admitted", "grant_or_cap_refused"]);
  assert.equal(sql(`select spent_micro from public.browser_signer_capacity where signer='${otherSigner}'`), "2");
  asService(grant("distinct-replacement", "owner", otherSigner, 100));
  assert.equal(sql("select spent*1000000=2 and spent*1000000=trunc(spent*1000000) from public.session_grants where session_id='owner'"), "t");
  asService(grant("original-return", "owner", signer, 100));
  assert.equal(sql(`select spent*1000000=${settleSpent} and spent*1000000=trunc(spent*1000000)
    from public.session_grants where session_id='owner'`), "t", "returning signer preserves its old holds");
  // No bearer or unrecognized input survives the challenge/metadata projection.
  const sanitized = journalTuple(270, { grant_epoch: "original-return" });
  assert.equal(asService(`select public.admit_browser_journal(${json(sanitized.i)},${json({ ...sanitized.r, paymentHeader: "synthetic-not-a-bearer" })},
    ${json({ ...sanitized.p, privateKey: "synthetic-not-a-key", signature: "synthetic-not-a-signature" })})`), "admitted");
  const sanitizedRead = asService("select public.get_browser_journal('owner','request-270')");
  assert(!sanitizedRead.includes("synthetic-not-a-"));
  assert.equal(JSON.parse(asService(terminal(270, "cancelled_unexposed", null))).resolved, true);
  for (let n = 0; n < 4; n++) {
    const id = 280 + n;
    assert.equal(asService(journal(id, { grant_epoch: "original-return" })), "admitted");
    const cap = sql(`select spent_micro from public.browser_signer_capacity where signer='${signer}'`);
    const raced = await Promise.allSettled([transition(id, "prepared", "exposed"), terminal(id, "cancelled_unexposed", null)].map(concurrent));
    const [exposure, cancellation] = raced.map(result => {
      if (result.status === "rejected") throw result.reason;
      return result.value;
    });
    const cancelled = JSON.parse(cancellation).resolved;
    assert.equal(exposure === "t", !cancelled, "exposure/cancel race must have one winner");
    assert.equal(sql(`select authorization_phase from public.payment_events where id='x402:${nonce(id)}'`), cancelled ? "cancelled_unexposed" : "exposed");
    assert.equal(Number(sql(`select spent_micro from public.browser_signer_capacity where signer='${signer}'`)), Number(cap) - (cancelled ? 1 : 0));
  }
  assert.equal(asService(`select public.browser_signer_confirmed_spend_micro('${signer}')`), "2", "pending/exposed/unknown holds are never confirmed credit");
  // Administrative synthetic fixtures emulate historical duplicates; application
  // writers cannot issue this private capability or insert these financial rows.
  sql(`begin; insert into public.browser_journal_writer values(txid_current());
    insert into public.payment_events select (jsonb_populate_record(null::public.payment_events,
      to_jsonb(p)||'{"id":"legacy-identical-duplicate"}'::jsonb)).* from public.payment_events p where id='legacy-orphan-settled';
    delete from public.browser_journal_writer where transaction_id=txid_current(); commit`);
  assert.equal(asService(`select public.browser_signer_confirmed_spend_micro('${signer.toUpperCase().replace("0X", "0x")}')`), "2", "identical nonce counts once");
  assert.throws(() => sql(`begin; insert into public.browser_journal_writer values(txid_current());
    insert into public.payment_events select (jsonb_populate_record(null::public.payment_events,
      to_jsonb(p)||'{"id":"legacy-conflicting-duplicate","query_id":"different"}'::jsonb)).* from public.payment_events p where id='legacy-orphan-settled';
    delete from public.browser_journal_writer where transaction_id=txid_current();
    set role service_role; select public.browser_signer_confirmed_spend_micro('${signer}'); commit`), /Conflicting confirmed authorization identity/);
  assert.equal(asService(`select public.browser_signer_confirmed_spend_micro('${signer}')`), "2");
  assert.equal(sql("select count(*) from public.browser_journal_writer"), "0");
  // Actual concurrent replacement holds its row while old revocation waits, then
  // commits a new generation. PostgreSQL rechecks the CAS against that new row.
  asService(grant("revoke-original", "revoke-owner"));
  assert.equal(asService(journal(290, { session_id: "revoke-owner", grant_epoch: "revoke-original" })), "admitted");
  assert.equal(asService(transition(290, "prepared", "exposed", "revoke-owner")), "t");
  const financialBefore = sql(`select jsonb_build_object('journal',public.get_browser_journal('revoke-owner','request-290'),
    'capacity',(select spent_micro from public.browser_signer_capacity where signer='${signer}'),
    'retained',(select spent_micro from public.browser_retained_grants where grant_epoch='revoke-original'))`);
  const startTransaction = (application: string, statement: string, held = false) => {
    const child = postgres.spawnClient();
    const completion = new Promise<{ ok: boolean; output: string }>(resolve => {
      let output = "";
      child.stdout?.on("data", value => { output += value; });
      child.on("error", () => resolve({ ok: false, output }));
      child.on("close", code => resolve({ ok: code === 0, output: output.trim() }));
    });
    child.stdin!.write(`set statement_timeout='15s';set role service_role;begin;set local application_name='${application}';${statement};\n`);
    if (!held) child.stdin!.end("commit;\n");
    return { child, completion };
  };
  const replacement = startTransaction("keryx-generation-replacement", grant("revoke-replacement", "revoke-owner"), true);
  let oldRevoke: ReturnType<typeof startTransaction> | undefined;
  try {
    const deadline = performance.now() + 10_000;
    const waitFor = async (predicate: string, message: string) => {
      while (sql(`select exists(select 1 from pg_stat_activity where ${predicate})`) !== "t") {
        assert(performance.now() < deadline, message);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    };
    await waitFor("application_name='keryx-generation-replacement' and state='idle in transaction'", "Actual replacement reached its held-row boundary");
    oldRevoke = startTransaction("keryx-generation-revoke", `select public.revoke_session_grant('revoke-owner','revoke-original','${signer}')`);
    await waitFor("application_name='keryx-generation-revoke' and wait_event_type='Lock'", "Old revocation actually waits for concurrent replacement");
    replacement.child.stdin!.end("commit;\n");
    assert((await replacement.completion).ok);
    const revoked = await oldRevoke.completion;
    assert(revoked.ok); assert.equal(revoked.output, "f");
  } finally {
    replacement.child.kill(); oldRevoke?.child.kill();
  }
  assert.equal(sql("select grant_epoch from public.session_grants where session_id='revoke-owner'"), "revoke-replacement");
  assert.equal(asService(`select public.revoke_session_grant('revoke-owner','revoke-replacement','${signer}')`), "t");
  assert.equal(sql("select expiry from public.session_grants where session_id='revoke-owner'"), "0");
  assert.equal(sql(`select jsonb_build_object('journal',public.get_browser_journal('revoke-owner','request-290'),
    'capacity',(select spent_micro from public.browser_signer_capacity where signer='${signer}'),
    'retained',(select spent_micro from public.browser_retained_grants where grant_epoch='revoke-original'))`), financialBefore);
  assert.equal(sql("select count(*) from public.browser_journal_writer"), "0");
  console.log("PASS: actual PG17 generation revoke contention, original exposed journal/cap retention and legacy CAS");
  const snapshot = journalState();
  await postgres.restart();
  assert.equal(journalState(), snapshot, "committed authority + retained capacity must survive DB process restart");
  assert.equal(asService(sign(231)), "t", "identical signed callback remains idempotent after restart");
  assert.equal(JSON.parse(asService(terminal(231, "failed"))).resolved, false, "settled cannot release after restart");
  assert.equal(journalState(), snapshot);
  console.log("PASS: PostgreSQL 17 complete accepted native migration profile; legacy exact conversion and retained orphan epochs; atomic intent/payment/cap bridge; real concurrent signer/alias caps; rollback and capability cleanup; service-only RPCs/RLS; NULL-resistant guards; old SQL/RPC fences; nonce collision defense; prepared-only cancellation; signing replay, terminal CAS/release and database-process restart persistence. Ordinary extensions install separately and refuse native. Synthetic unfunded fixtures and terminal identifiers only, no real signatures/transfers. Restart does not prove power-loss durability.");
} finally { postgres.close(); }
