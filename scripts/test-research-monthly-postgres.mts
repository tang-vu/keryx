import { execFile, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { a2aOrderId, a2aRequestHash, type A2aOrder } from "../lib/a2a/order";
import { a2aResearchPackage } from "../lib/a2a/research-package-definition";
import { monthlyPurchaseId, monthlyOrderId, monthlyOrderToRow, MONTHLY_TERM_MS, type MonthlyPurchase } from "../lib/db/research-monthly";

// Only a disposable, network-isolated PostgreSQL container: synthetic fixtures, no secrets,
// host mounts, published ports, signing or settlement. Each race uses distinct psql sessions.
const name = `keryx-monthly-test-${Date.now()}`;
const binary = process.platform === "win32" ? "wsl.exe" : "docker";
const prefix = process.platform === "win32" ? ["-d", "Ubuntu", "--", "docker"] : [];
const docker = (args: string[], input?: string) => execFileSync(binary, [...prefix, ...args],
  { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const psql = ["exec", "-i", name, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A"];
const sql = (input: string, database = "postgres") => docker([...psql, "-d", database], input);
const concurrent = (input: string) => new Promise<string>((resolve, reject) => {
  const child = execFile(binary, [...prefix, ...psql], { encoding: "utf8" },
    (error, stdout) => error ? reject(error) : resolve(stdout));
  child.stdin!.end(`set role service_role; begin; ${input}; select pg_sleep(0.25); commit;`);
});
const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const json = (value: unknown) => `${literal(JSON.stringify(value))}::jsonb`;
const result = (output: string) => JSON.parse(output.trim().split("\n").find(line => line.startsWith("{"))!) as { created: boolean; purchase?: MonthlyPurchase; order?: Record<string, unknown> };
const migration = readFileSync("supabase/migrations/0067_research_monthly.sql", "utf8");
const prerequisite = readFileSync("supabase/migrations/0038_a2a_orders.sql", "utf8")
  + readFileSync("supabase/migrations/0039_async_a2a_jobs.sql", "utf8")
  + `alter table public.a2a_orders add column package_data jsonb, add column resolution_data jsonb,
      add column execution_journal_version smallint, add column payment_started_at timestamptz, add column result_saving_at timestamptz;
    create table public.payment_events(id text,payer text,payee text,network text,authorization_id text,amount_usdc numeric,kind text,query_id text);
    grant all on public.a2a_orders to service_role;`;
function purchase(nonce: string, mode: "quick" | "deep" = "deep"): MonthlyPurchase {
  const identity = { network: "eip155:5042002", payer: `0x${"1".repeat(40)}`, payee: `0x${"2".repeat(40)}`, authorizationId: nonce };
  const createdAt = "2026-10-01T00:00:00.000Z";
  return { id: monthlyPurchaseId(identity), payer: identity.payer, payee: identity.payee, authorizationId: nonce,
    transaction: `synthetic-circle-${nonce}`, quoteId: "b".repeat(64), createdAt,
    expiresAt: new Date(Date.parse(createdAt) + MONTHLY_TERM_MS).toISOString(), creatorBudgetMicros: 50000,
    serviceFeeMicros: 180000, totalMicros: 380000, researchPackage: a2aResearchPackage(mode) };
}
function order(parent: MonthlyPurchase, requestId: string, question = "What evidence supports Arc finality?", model?: string): A2aOrder {
  const id = monthlyOrderId(parent.id, requestId);
  const value = { id, queryId: id, authorizationId: `${parent.authorizationId}:monthly:${requestId}`,
    payer: parent.payer, payee: parent.payee, amountUsdc: parent.totalMicros / 4 / 1e6,
    creatorBudgetUsdc: parent.creatorBudgetMicros / 1e6, serviceFeeUsdc: parent.serviceFeeMicros / 4 / 1e6,
    researchMode: parent.researchPackage.researchMode, researchPackage: parent.researchPackage, status: "running" as const,
    transaction: parent.transaction, request: { question, origin: "a2a" as const, monthlyId: parent.id, ...(model ? { model } : {}) },
    startedAt: null, workerId: null, executionJournalVersion: 1 as const, paymentStartedAt: null, resultSavingAt: null,
    response: null, errorCode: null, resolution: null, createdAt: parent.createdAt, updatedAt: parent.createdAt };
  return { ...value, requestHash: a2aRequestHash({ ...value, question, model }) };
}
const create = (parent: MonthlyPurchase) => `select public.create_research_monthly(${json(parent)})`;
const redeem = (parent: MonthlyPurchase, requestId: string, proposed = order(parent, requestId), now = parent.createdAt, payer = parent.payer) =>
  `select public.redeem_research_monthly(${literal(parent.id)},${literal(payer)},${literal(requestId)},${literal(now)}::timestamptz,${json(monthlyOrderToRow(proposed))})`;
function claim(parent: MonthlyPurchase, purpose: "monthly" | "a2a" | "resource", payee = parent.payee) {
  return `select public.claim_research_purchase(${json({ network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000",
    payer: parent.payer, payee, authorization_id: parent.authorizationId.toLowerCase(), product: purpose,
    purchase_id: purpose === "monthly" ? monthlyPurchaseId({ network: "eip155:5042002", ...parent, payee }) : a2aOrderId({ network: "eip155:5042002", ...parent, payee }),
    request_hash: parent.quoteId, amount_micros: parent.totalMicros })})`;
}
let started = false;
try {
  docker(["run", "-d", "--name", name, "--network", "none", "--memory", "256m", "--cpus", "1", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17"]); started = true;
  for (let retry = 0; ; retry++) {
    try { docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]); break; }
    catch { if (retry === 60) throw new Error("PostgreSQL unavailable"); await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  sql("create role anon; create role authenticated; create role service_role bypassrls;\n" + prerequisite + "begin;" + migration + "commit;");
  const admitted = purchase(`0x${"a".repeat(64)}`);
  sql(`set role service_role; ${claim(admitted, "monthly")};`);
  assert.equal(sql("select count(*) from public.research_monthly").trim(), "0", "admission must not grant entitlement");
  for (const purpose of ["a2a", "resource"] as const) assert.throws(() => sql(`set role service_role; ${claim(admitted, purpose)};`), /claim conflict/);
  assert.throws(() => sql(`set role service_role; ${claim(admitted, "monthly", `0x${"3".repeat(40)}`)};`), /claim conflict/);
  const competing = purchase(`0x${"c".repeat(64)}`);
  const purposes = await Promise.allSettled([concurrent(claim(competing, "monthly")), concurrent(claim(competing, "a2a"))]);
  assert.equal(purposes.filter(value => value.status === "fulfilled").length, 1, "different purposes race for one nonce");
  const created = (await Promise.all([concurrent(create(admitted)), concurrent(create(admitted))])).map(output => result(output).created).sort();
  assert.deepEqual(created, [false, true]);
  assert.throws(() => sql(`set role service_role; ${create({ ...admitted, transaction: "changed" })};`), /replay conflict/);
  for (const field of [{ creatorBudgetUsdc: .06 }, { amountUsdc: .1 }, { workerId: "unexpected-worker" }, { requestHash: "d".repeat(64) }]) {
    assert.throws(() => sql(`set role service_role; ${redeem(admitted, "invalid", { ...order(admitted, "invalid"), ...field })};`), /contract mismatch/);
  }
  assert.throws(() => sql(`set role service_role; ${redeem(admitted, "foreign", order(admitted, "foreign"), admitted.createdAt, `0x${"9".repeat(40)}`)};`), /owner\/request mismatch/);
  assert.equal(sql(`select count(*) from public.research_monthly_redemptions where monthly_id=${literal(admitted.id)}`).trim(), "0");
  const attempts = await Promise.allSettled(Array.from({ length: 8 }, (_, n) => concurrent(redeem(admitted, `request-${n}`))));
  assert.equal(attempts.filter(value => value.status === "fulfilled").length, 4, "eight independent sessions can consume only four slots");
  for (const attempt of attempts) if (attempt.status === "rejected") assert.match(String(attempt.reason), /Monthly request limit reached/);
  const slots = sql(`select string_agg(slot::text,',' order by slot) from public.research_monthly_redemptions where monthly_id=${literal(admitted.id)}`).trim();
  assert.equal(slots, "0,1,2,3");
  const acceptedRequest = sql(`select request_id from public.research_monthly_redemptions where monthly_id=${literal(admitted.id)} and slot=0`).trim();
  sql(`set role service_role; update public.a2a_orders set status='failed',error_code='synthetic_failure' where id=${literal(monthlyOrderId(admitted.id, acceptedRequest))};`);
  const replay = result(sql(`set role service_role; ${redeem(admitted, acceptedRequest, order(admitted, acceptedRequest), admitted.expiresAt)};`));
  assert.equal(replay.created, false); assert.equal(replay.order?.status, "failed");
  assert.throws(() => sql(`set role service_role; ${redeem(admitted, acceptedRequest, order(admitted, acceptedRequest, "Different question"), admitted.expiresAt)};`), /replay conflict/);
  assert.throws(() => sql(`set role service_role; ${redeem(admitted, "replacement")};`), /limit reached/);
  assert.equal(sql("select count(*) from public.research_purchase_authorizations where authorization_id like '%:monthly:%'").trim(), "0");
  assert.equal(sql("select count(*) from public.payment_events").trim(), "0");

  // Same-request insertion and whole-transaction rollback, plus escaped Unicode/hash parity.
  const quick = purchase(`0x${"e".repeat(64)}`, "quick"); sql(`set role service_role; ${create(quick)};`);
  const exact = order(quick, "same", 'Quote "a" and apostrophe \' plus newline\nΚῆρυξ', "synthetic-model");
  assert.deepEqual((await Promise.all([concurrent(redeem(quick, "same", exact)), concurrent(redeem(quick, "same", exact))])).map(output => result(output).created).sort(), [false, true]);
  const collision = order(quick, "collision");
  sql(`insert into public.a2a_orders select (jsonb_populate_record(null::public.a2a_orders,${json(monthlyOrderToRow(collision))})).*;`);
  assert.throws(() => sql(`set role service_role; ${redeem(quick, "collision")};`), /duplicate key/);
  assert.equal(sql(`select count(*) from public.research_monthly_redemptions where monthly_id=${literal(quick.id)}`).trim(), "1", "failed order insertion rolls back slot");
  assert.throws(() => sql(`set role service_role; ${redeem(quick, "expired", order(quick, "expired"), quick.expiresAt)};`), /term expired/);
  for (const role of ["anon", "authenticated"]) {
    assert.throws(() => sql(`set role ${role}; ${create(quick)};`), /permission denied/);
    for (const table of ["research_monthly", "research_monthly_redemptions", "research_purchase_authorizations"]) assert.throws(() => sql(`set role ${role}; select * from public.${table};`), /permission denied/);
  }
  for (const table of ["research_monthly", "research_monthly_redemptions", "research_purchase_authorizations"]) assert.throws(() => sql(`set role service_role; delete from public.${table};`), /immutable/);

  // Historical conflicting nonce tuples must halt migration rather than choose a winner.
  sql("create database ambiguous_history;"); sql(prerequisite, "ambiguous_history");
  const historical = { ...order(quick, "historical"), authorizationId: quick.authorizationId };
  const altered = { ...historical, id: "a2a_other_historical", queryId: "a2a_other_historical", payee: `0x${"3".repeat(40)}` };
  sql(`insert into public.a2a_orders select (jsonb_populate_record(null::public.a2a_orders,${json(monthlyOrderToRow(historical))})).*;
    insert into public.a2a_orders select (jsonb_populate_record(null::public.a2a_orders,${json(monthlyOrderToRow(altered))})).*;`, "ambiguous_history");
  assert.throws(() => sql("begin;" + migration + "commit;", "ambiguous_history"), /Ambiguous historical research authorization/);
  for (const kind of ["fetch", "inbound"]) {
    const database = `${kind}_history`; sql(`create database ${database};`); sql(prerequisite, database);
    sql(`insert into public.a2a_orders select (jsonb_populate_record(null::public.a2a_orders,${json(monthlyOrderToRow(historical))})).*;
      insert into public.payment_events values('historical',${literal(historical.payer)},${literal(historical.payee)},'eip155:5042002',${literal(historical.authorizationId)},${historical.amountUsdc},${literal(kind)},${literal(kind === "inbound" ? historical.id : "other-query")});`, database);
    if (kind === "fetch") assert.throws(() => sql("begin;" + migration + "commit;", database), /Ambiguous historical research authorization/);
    else {
      sql(`insert into public.payment_events select 'duplicate-observation',payer,payee,network,authorization_id,amount_usdc,kind,query_id from public.payment_events;`, database);
      sql("begin;" + migration + "commit;", database);
      assert.equal(sql("select count(*) from public.research_purchase_authorizations", database).trim(), "1");
    }
  }
  console.log("PASS: PostgreSQL 17 independent-session purpose/nonce admission, four-slot bound, immutable purchase replay, post-expiry request replay, hash/package parity, rollback and service-only permissions. Synthetic database fixtures only; no settlement.");
} finally { if (started) docker(["rm", "-f", name]); }
