/** Actual ordinary0086 SQL. Synthetic fresh database only; no payments/providers. */
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, realpathSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { createSqliteDecisionReviews } from "../lib/db/decision-reviews-sqlite.ts";
import { decisionReviewMetricsSchema, decisionReviewSchema, type CaptureDecision } from "../lib/research/decision-review-types.ts";
const execute = promisify(execFile), name = `keryx-reviews-${randomUUID()}`, database = `decision_reviews_${randomUUID().replaceAll("-", "")}`;
const argv = process.argv.slice(2); let bin: string | undefined, port: string | undefined, cluster: string | undefined;
if (argv.length) {
  assert.equal(argv.length, 6); assert.equal(argv[0], "--psql-bin"); assert.equal(argv[2], "--port"); assert.equal(argv[4], "--cluster-dir");
  assert.ok(isAbsolute(argv[1])); bin = realpathSync(join(argv[1], process.platform === "win32" ? "psql.exe" : "psql"));
  port = argv[3]; assert.match(port, /^[1-9]\d{3,4}$/); assert.ok(Number(port) <= 65535);
  assert.ok(isAbsolute(argv[5])); cluster = realpathSync(argv[5]);
}
const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP,
  PGPASSFILE: join(tmpdir(), `${name}-no-password-file`), PGSERVICEFILE: join(tmpdir(), `${name}-no-service-file`), PGAPPNAME: "keryx-synthetic-decision-reviews" };
const docker = (args: string[], input?: string) => execFileSync("docker", args, { input, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
const clientArgs = (db: string) => ["-X", "-w", "-h", "127.0.0.1", ...(port ? ["-p", port] : []), "-U", "postgres", "-d", db, "-qAt", "-v", "ON_ERROR_STOP=1"];
const sql = (statement: string, db = database): string => (bin ? execFileSync(bin, clientArgs(db), { env, input: statement, encoding: "utf8", timeout: 30000, maxBuffer: 8 * 1024 * 1024 }) : docker(["exec", "-i", name, "psql", ...clientArgs(db)], statement)).trim();
async function parallelSql(statement: string) {
  // -c avoids unmanaged stdin in parallel clients; every value is our quoted fixture.
  const result = bin ? await execute(bin, [...clientArgs(database), "-c", statement], { env, timeout: 30000 }) : await execute("docker", ["exec", name, "psql", ...clientArgs(database), "-c", statement], { timeout: 30000 });
  return result.stdout.trim();
}
const quote = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const owner = `0x${"1".repeat(40)}`, other = `0x${"2".repeat(40)}`, runId = randomUUID();
const input: CaptureDecision = { policyVersion: "captured-owner-decisions-v1", engine: "synthetic", requestedModel: null, runId, round: 0, ordinal: 0,
  sourceName: "PRIVATE SYNTHETIC SOURCE", modelAction: "BUY", codeAction: "BUY", codeRule: "selected", reviewFirst: true, cohort: "unknown", cohortEvidence: null,
  terms: { assetId: "asset-one", sourceId: "source-one", owned: true, network: "eip155:5042002", payTo: other, priceMicroUsdc: "1000", listPriceMicroUsdc: "1000", citationBudgetMicroUsdc: "5000", claimDigest: "a".repeat(64) } };
const call = (operation: string, value: unknown, wallet: string | null = owner) => `set role service_role; select public.decision_reviews_v1('${operation}',${wallet ? `'${wallet}'` : "null"},${quote(value)});`;
const rpc = (operation: string, value: unknown, wallet: string | null = owner) => { const result = sql(call(operation, value, wallet)); return result ? JSON.parse(result) : null; };
const capture = (patch: Partial<CaptureDecision> = {}) => decisionReviewSchema.parse(rpc("capture", { ...input, ...patch }));
let container = false, created = false;
try {
  if (!bin) {
    docker(["info", "--format", "{{.ServerVersion}}"]);
    container = true; docker(["run", "-d", "--name", name, "--network", "none", "--memory", "512m", "--cpus", "1", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"]);
    const deadline = Date.now() + 30000;
    for (;;) { try { assert.equal(sql("select 1;", "postgres"), "1"); break; } catch (cause) { if (Date.now() > deadline) throw new Error("Owned fixture startup unavailable", { cause }); await new Promise(resolve => setTimeout(resolve, 100)); } }
  } else assert.match(execFileSync(bin, ["--version"], { env, encoding: "utf8", timeout: 10000 }), /PostgreSQL\) 17\./);
  assert.match(sql("show server_version;", "postgres"), /^17\./);
  if (cluster) assert.equal(realpathSync(sql("show data_directory;", "postgres")), cluster);
  created = true; sql(`create database ${database};`, "postgres");
  // These global fixture roles are created only in a root-provisioned fresh cluster or our owned container.
  sql("do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end $$;");
  sql(readFileSync("supabase/migrations/0086_decision_reviews.sql", "utf8"));
  assert.deepEqual(rpc("ready", {}, null), { ready: true });
  for (const role of ["anon", "authenticated"]) {
    assert.throws(() => sql(`set role ${role}; select * from public.decision_review_records;`), /permission denied/);
    assert.throws(() => sql(`set role ${role}; select public.decision_reviews_v1('ready',null,'{}');`), /permission denied/);
  }
  const record = capture(); assert.equal(record.state, "observed"); assert.equal(record.expiresAt, null);
  assert.equal(rpc("read", { id: record.id }, other), null); assert.deepEqual(rpc("list", { runId }, other), []);
  assert.throws(() => rpc("verdict", { id: record.id, key: randomUUID(), context: "opinion", expectedCode: { action: "BUY", rule: "selected" }, value: "agree" }, other), /review_not_found/);
  const begun = decisionReviewSchema.parse(rpc("begin", { id: record.id })); assert.equal(begun.state, "held");
  assert.ok(Date.parse(begun.expiresAt!) - Date.now() > 50000); assert.throws(() => rpc("begin", { id: record.id }), /review_conflict/);
  const verdict = { id: record.id, key: randomUUID(), context: "gate", value: "agree", reason: "PRIVATE SYNTHETIC REASON" };
  const votes = await Promise.allSettled([parallelSql(call("verdict", verdict)), parallelSql(call("verdict", { ...verdict, key: randomUUID(), value: "disagree" }))]);
  assert.equal(votes.filter(row => row.status === "fulfilled").length, 1);
  // An ordered winning Agree is deterministic: no test depends on scheduler winning this race.
  const admitted = capture({ ordinal: 1 }); rpc("begin", { id: admitted.id }); const intent = { ...verdict, id: admitted.id, key: randomUUID() };
  rpc("verdict", intent); assert.throws(() => rpc("consume", { id: admitted.id, terms: { ...admitted.terms, priceMicroUsdc: "1001" } }), /review_conflict/);
  const consumes = await Promise.allSettled([parallelSql(call("consume", { id: admitted.id, terms: admitted.terms })), parallelSql(call("consume", { id: admitted.id, terms: admitted.terms }))]);
  assert.equal(consumes.filter(row => row.status === "fulfilled").length, 1);
  assert.equal(rpc("verdict", intent).state, "consumed"); assert.throws(() => rpc("verdict", { ...intent, value: "disagree" }), /review_conflict/);
  rpc("verdict", { ...intent, key: randomUUID(), context: "opinion", expectedCode: { action: "BUY", rule: "selected" }, value: "disagree" }); assert.equal(rpc("read", { id: admitted.id }).state, "consumed");
  const expired = capture({ ordinal: 2 }); rpc("begin", { id: expired.id }); sql(`update public.decision_review_records set expires_at=clock_timestamp()-interval '1 second' where id='${expired.id}';`);
  assert.throws(() => rpc("verdict", { ...intent, id: expired.id, key: randomUUID() }), /review_expired/); rpc("expire", { id: expired.id }); assert.equal(rpc("read", { id: expired.id }).state, "expired");
  const deferred = capture({ ordinal: 3 }); assert.equal(deferred.expiresAt, null); rpc("cancel", { runId }); assert.equal(rpc("read", { id: deferred.id }).state, "cancelled");
  assert.throws(() => rpc("begin", { id: deferred.id }), /review_conflict/);
  const stale = capture({ ordinal: 4 }), next = capture({ ordinal: 5 }); rpc("begin", { id: stale.id });
  rpc("verdict", { ...intent, id: stale.id, key: randomUUID() }); rpc("observe", { id: stale.id, action: "SKIP", rule: "terms-changed" });
  assert.equal(rpc("read", { id: stale.id }).state, "cancelled"); assert.equal(rpc("read", { id: stale.id }).verdict.codeAction, "BUY");
  assert.throws(() => rpc("consume", { id: stale.id, terms: stale.terms }), /review_conflict/);
  assert.equal(rpc("begin", { id: next.id }).state, "held"); rpc("verdict", { ...intent, id: next.id, key: randomUUID(), value: "disagree" });
  const observed = capture({ ordinal: 6, reviewFirst: false }), opinion = { id: observed.id, key: randomUUID(), context: "opinion", value: "agree", expectedCode: { action: "BUY", rule: "selected" } };
  rpc("verdict", opinion); rpc("observe", { id: observed.id, action: "SKIP", rule: "budget" });
  const staleOpinions = await Promise.allSettled([parallelSql(call("verdict", { ...opinion, key: randomUUID() })), parallelSql(call("verdict", { ...opinion, key: randomUUID() }))]);
  assert.equal(staleOpinions.filter(row => row.status === "fulfilled").length, 0);
  assert.equal(rpc("verdict", opinion).codeAction, "SKIP"); assert.equal(rpc("verdict", opinion).verdict.codeAction, "BUY");
  rpc("verdict", { ...opinion, key: randomUUID(), value: "disagree", expectedCode: { action: "SKIP", rule: "budget" } });
  assert.equal(rpc("read", { id: observed.id }).verdict.codeRule, "budget");
  for (const invalid of [{ ...input, codeRule: "fabricated" }, { ...input, cohort: null }, { ...input, terms: { ...input.terms, owned: null } },
    { ...input, terms: { ...input.terms, priceMicroUsdc: "0.1" } }, { ...input, terms: { ...input.terms, priceMicroUsdc: "9007199254740992" } }, { ...input, injected: true }]) assert.throws(() => rpc("capture", invalid), /review_unavailable/);
  for (const invalid of [{}, { network: "eip155:5042002", until: "2026-10-10T00:00:00.000Z" }, { network: "eip155:5042002", since: null, until: "2026-10-10T00:00:00.000Z" },
    { network: "eip155:5042002", since: "2026-02-30T00:00:00.000Z", until: "2026-03-01T00:00:00.000Z" }]) assert.throws(() => rpc("metrics", invalid, null));
  rpc("observe", { id: expired.id, action: "SKIP", rule: "budget" }); assert.throws(() => rpc("observe", { id: expired.id, action: "SKIP", rule: "fabricated" }), /review_unavailable/);
  assert.equal(rpc("read", { id: expired.id }).initialCodeAction, "BUY");
  sql("update public.decision_review_records set created_at='2026-10-09T12:00:00.000Z';");
  const period = { network: "eip155:5042002", since: "2026-10-09T00:00:00.000Z", until: "2026-10-10T00:00:00.000Z" };
  const metrics = decisionReviewMetricsSchema.parse(rpc("metrics", period, null)); assert.equal(metrics.cohorts[0].agreementRate, null);
  assert.equal(metrics.cohorts[3].codeRefusals, 3); assert.deepEqual(metrics.cohorts[3].refusalReasons, { budget: 2, "terms-changed": 1 });
  assert.doesNotMatch(JSON.stringify(metrics), /PRIVATE|source-one|asset-one|wallet|runId|claimDigest|reason"/);
  // More than PostgREST's usual row limit: aggregate the complete cohort, not a sampled read.
  const cohortInputs: CaptureDecision[] = Array.from({ length: 1201 }, () => ({ ...input, runId: randomUUID(), reviewFirst: false,
    modelAction: "SKIP", codeAction: "SKIP", codeRule: "model-skip", cohort: "scripted", cohortEvidence: "trusted-synthetic-fixture" }));
  assert.equal(sql(`set role service_role; select count(public.decision_reviews_v1('capture','${owner}',value)) from jsonb_array_elements(${quote(cohortInputs)});`), "1201");
  sql("update public.decision_review_records set created_at='2026-10-09T12:00:00.000Z' where input_json->>'cohort'='scripted';");
  const complete = decisionReviewMetricsSchema.parse(rpc("metrics", period, null)), connection = new DatabaseSync(":memory:");
  try {
    const sqlite = createSqliteDecisionReviews(connection);
    for (const captured of cohortInputs) await sqlite.capture(owner, captured, Date.parse("2026-10-09T12:00:00.000Z"));
    const equivalent = await sqlite.metrics("eip155:5042002", period.since, period.until);
    assert.deepEqual(complete.cohorts[2], equivalent.cohorts[2]); assert.equal(complete.cohorts[2].decisions, 1201);
    assert.deepEqual(complete.cohorts[0], equivalent.cohorts[0]);
  } finally { connection.close(); }
  sql("create schema keryx_storage; create table keryx_storage.identity(enrolled boolean); insert into keryx_storage.identity values(true); grant usage on schema keryx_storage to service_role; grant select on keryx_storage.identity to service_role;");
  for (const statement of [call("ready", {}, null), call("read", { id: admitted.id }), call("metrics", period, null), `set role service_role; select public.decision_review_record_v1('${admitted.id}','${owner}');`]) assert.throws(() => sql(statement), /review_unavailable/);
  console.log("Decision review PostgreSQL17 passed: actual0086 owner/ACL/strict terms+rule+period, per-request deadline, concurrent verdict/consume CAS, exact-intent current readback, stale opinion snapshot refusal/retained vote basis, individual source cancellation, expiry/cancel, whole1201-row aggregate/SQLite parity/privacy and sealed refusal. Synthetic only.");
} finally {
  if (created) sql(`drop database if exists ${database} with (force);`, "postgres");
  if (container) { if (docker(["ps", "-aq", "--filter", `name=^/${name}$`]).trim()) docker(["rm", "-f", name]); assert.equal(docker(["ps", "-aq", "--filter", `name=^/${name}$`]).trim(), ""); }
}
