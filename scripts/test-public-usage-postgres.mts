/** Actual ordinary0089 acceptance only in one fresh owner-labelled PG17 fixture.
 * No ambient database credentials, shared DDL, application initialization or providers. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { projectUsageCorpus, usageWindow } from "../lib/usage/contracts.ts";
import { createTrustedUsageContext, newRunUsage } from "../lib/research/usage-provenance.ts";
import { capturePublicUsageFixtureCommand, publicUsageFixtureCommandSucceeded, publicUsageFixtureCommandDiagnostic } from "../test-support/public-usage-fixture-command.ts";
assert.deepEqual(process.argv.slice(2), ["--acceptance"]);
const fixtureId = randomUUID(), name = `keryx-public-usage-${fixtureId}`, labelKey = "keryx.public-usage.fixture";
const config = mkdtempSync(join(tmpdir(), "keryx-public-usage-docker-"));
const out = resolve("artifacts/public-usage-postgres", fixtureId); mkdirSync(out, { recursive: true });
const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP, DOCKER_CONFIG: config };
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const receipts: Record<string, unknown>[] = [], cases: string[] = [];
let sequence = 0, containerId: string | undefined, imageId: string | undefined, sourceCommit: string | undefined, version: string | undefined, failure: unknown;
async function command(executable: string, args: string[], input?: string) {
  const capture = await capturePublicUsageFixtureCommand(executable, args, env, input);
  const { stdout, stderr, ...lifecycle } = capture;
  const label = `command-${String(++sequence).padStart(4, "0")}`;
  writeFileSync(join(out, `${label}.stdout.raw`), stdout, { flag: "wx" }); writeFileSync(join(out, `${label}.stderr.raw`), stderr, { flag: "wx" });
  const receipt = { label, executable, args, ...lifecycle,
    inputSha256: hash(input ?? ""), stdoutSha256: hash(stdout), stderrSha256: hash(stderr), stdoutBytes: stdout.length, stderrBytes: stderr.length };
  receipts.push(receipt); writeFileSync(join(out, `${label}.json`), JSON.stringify(receipt, null, 2), { flag: "wx" });
  if (!publicUsageFixtureCommandSucceeded(capture))
    throw Error(`Owned fixture command refused: ${JSON.stringify(publicUsageFixtureCommandDiagnostic(label, capture))}`);
  return stdout.toString("utf8").trim();
}
const docker = (args: string[], input?: string) => command("docker", args, input);
const sql = (statement: string) => docker(["exec", "-i", name, "psql", "-X", "-w", "-h", "127.0.0.1", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], `set statement_timeout='15s';${statement}`);
const window = usageWindow(new URLSearchParams("since=2026-10-01"), "eip155:5042", new Date("2026-10-11T00:00:00.000Z"));
const rpc = (value: unknown = window, role = "service_role") => sql(`set role ${role};select public.public_usage_window_v1(${quote(JSON.stringify(value))}::jsonb);`);
const originals = () => sql("select encode(sha256(convert_to(jsonb_build_array((select jsonb_agg(to_jsonb(q) order by id) from public.query_runs q),(select jsonb_agg(to_jsonb(p) order by id) from public.payment_events p))::text,'UTF8')),'hex');");
try {
  sourceCommit = await command("git", ["rev-parse", "HEAD"]); assert.match(sourceCommit, /^[a-f0-9]{40}$/);
  await docker(["info", "--format", "{{.ServerVersion}}"]);
  imageId = await docker(["image", "inspect", "postgres:17-alpine", "--format", "{{.Id}}"]); assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  containerId = await docker(["run", "-d", "--pull=never", "--name", name, "--label", `${labelKey}=${fixtureId}`, "--network", "none", "--memory", "512m", "--cpus", "1", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17-alpine"]);
  assert.match(containerId, /^[a-f0-9]{64}$/); const deadline = Date.now() + 15000;
  for (;;) { try { assert.equal(await sql("select 1;"), "1"); break; } catch { if (Date.now() >= deadline) throw Error("Owned PG startup refused"); await new Promise(done => setTimeout(done, 100)); } }
  version = await sql("show server_version;"); assert.match(version, /^17\./);
  await sql("create role anon;create role authenticated;create role service_role bypassrls;create publication supabase_realtime;");
  const migrations = ["0001_keryx_schema.sql", "0017_query_run_asker.sql", "0028_payment_settlement_state.sql"];
  for (const file of migrations) await sql(readFileSync(`supabase/migrations/${file}`, "utf8"));
  const migration = readFileSync("supabase/migrations/0089_public_usage_window.sql", "utf8");
  for (const marker of ["public.keryx_storage_identity", "keryx_storage.identity"]) {
    if (marker.startsWith("keryx_storage.")) await sql("create schema keryx_storage;"); await sql(`create table ${marker}(invalid text);`);
    await assert.rejects(sql(migration), /usage_unavailable/); assert.equal(await sql("select to_regprocedure('public.public_usage_window_v1(jsonb)') is null;"), "t");
    await sql(`drop table ${marker};`); if (marker.startsWith("keryx_storage.")) await sql("drop schema keryx_storage;");
  } cases.push("native markers refuse installation before capability creation");
  await sql(migration); const wallet = `0x${"a".repeat(40)}`, proof = "a".repeat(64);
  const usage = newRunUsage({ usageContext: createTrustedUsageContext(window.network, { actor: "outside", funding: "sponsored", scripted: false, actorEvidenceSha256: proof, fundingEvidenceSha256: proof }) }, window.network, []);
  const scripted = newRunUsage({ usageContext: createTrustedUsageContext(window.network, { actor: "unknown", funding: "unknown", scripted: true }) }, window.network, []);
  const save = (id: string, value: unknown, date = "2026-10-01T00:00:00.000Z") => sql(`insert into public.query_runs(id,created_at,question,budget,engine,asker,data) values(${quote(id)},${quote(date)},'Synthetic question never returned',0,'heuristic',${quote(wallet)},${quote(JSON.stringify({ id, createdAt: date, usage: value, answer: "Synthetic private body never returned" }))}::jsonb);`);
  await save("outside-old", usage); await save("legacy", null); await save("other-network", { ...usage, network: "eip155:5042002" });
  await save("upper-bound", usage, window.until); await save("before-lower", usage, "2026-09-30T23:59:59.999Z");
  await sql(`insert into public.query_runs(id,created_at,question,budget,engine,data) select 'scripted-'||n,'2026-10-10T00:00:00Z','Synthetic question',0,'heuristic',jsonb_build_object('usage',${quote(JSON.stringify(scripted))}::jsonb) from generate_series(1,2100) n;
    insert into public.payment_events(id,query_id,source_id,kind,payer,payee,amount_usdc,network,settled,settlement_status,tx_hash)
    select 'script-payment-'||n,'scripted-'||n,'fixture','fetch',${quote(wallet)},${quote(wallet)},0.000001,${quote(window.network)},true,'settled','synthetic-recorded-reference' from generate_series(1,2100) n;
    insert into public.payment_events(id,query_id,source_id,kind,payer,payee,amount_usdc,network,settled,settlement_status,tx_hash) values
    ('one','outside-old','fixture','fetch',${quote(wallet)},${quote(wallet)},0.000001,${quote(window.network)},true,'settled','synthetic-recorded-reference'),
    ('fraction','outside-old','fixture','fetch',${quote(wallet)},${quote(wallet)},0.12345600000000000001,${quote(window.network)},true,'settled','synthetic-recorded-reference'),
    ('pending','outside-old','fixture','fetch',${quote(wallet)},${quote(wallet)},1,${quote(window.network)},false,'pending',null),
    ('legacy-net','legacy','fixture','citation',${quote(wallet)},${quote(wallet)},0.000001,${quote(window.network)},true,'settled','synthetic-recorded-reference');`);
  const before = await originals(), raw = await rpc(), corpus = JSON.parse(raw), summary = projectUsageCorpus(corpus, window).summary;
  assert.equal(corpus.runs.length, 2103); assert.equal(corpus.payments.length, 2104);
  assert.equal(summary.columns[0].researchRuns, 1); assert.equal(summary.columns[2].researchRuns, 2100);
  assert.equal(summary.columns[2].settledPayments, 2100); assert.equal(summary.columns[2].settledMicros, "2100");
  assert.equal(summary.columns[2].payingRuns, 2100); assert.equal(summary.columns[2].unknownFundingPayingRuns, 2100);
  assert.equal(summary.columns[0].settledMicros, "1"); assert.equal(summary.columns[0].sponsoredPayingRuns, 1); assert.equal(summary.columns[0].independentPayingRuns, 0);
  assert.equal(summary.columns[3].researchRuns, 1); assert.equal(summary.columns[3].people, 0); assert.equal(summary.columns[0].acceptedDeliverables, null);
  assert.doesNotMatch(raw, /Synthetic question|Synthetic private body|payer/); assert.match(before, /^[a-f0-9]{64}$/); assert.equal(await originals(), before);
  cases.push("whole2103-run/2104-payment window beyond reducer2000 and REST1000; exact UTC/network/projection/sponsorship/micro-USDC and unchanged original-row SHA256");
  for (const role of ["anon", "authenticated"]) await assert.rejects(rpc(window, role), /permission denied/);
  for (const value of [{}, { ...window, extra: true }, { ...window, network: "other" }, { ...window, since: window.until }, { ...window, until: "2026-10-11" }, { ...window, period: "other" }, { ...window, period: "all" }, { ...window, period: "7d" }, { ...window, since: "2026-10-01T00:00:00.001Z" }]) await assert.rejects(rpc(value), /usage_unavailable/);
  cases.push("service-role-only execution, finite closed/canonical filter contracts");
  for (const marker of ["public.keryx_storage_identity", "keryx_storage.identity"]) {
    if (marker.startsWith("keryx_storage.")) await sql("create schema keryx_storage;"); await sql(`create table ${marker}(invalid text);`);
    await assert.rejects(rpc(), /usage_unavailable/); await sql(`drop table ${marker};`); if (marker.startsWith("keryx_storage.")) await sql("drop schema keryx_storage;");
  } cases.push("later native marker refuses ordinary query without reads/fallback");
  await sql("truncate public.query_runs,public.payment_events;");
  await sql("insert into public.query_runs(id,created_at,question,budget,data) select n::text,'2026-10-10T00:00:00Z','Synthetic',0,'{}'::jsonb from generate_series(1,10001) n;");
  await assert.rejects(rpc(), /usage_unavailable/); await sql("truncate public.query_runs;");
  await save("single", usage); await sql(`insert into public.payment_events(id,query_id,source_id,kind,payer,payee,amount_usdc,network,settled,settlement_status) select n::text,'single','fixture','fetch',${quote(wallet)},${quote(wallet)},0,${quote(window.network)},false,'simulated' from generate_series(1,50001) n;`);
  await assert.rejects(rpc(), /usage_unavailable/); await sql("truncate public.query_runs,public.payment_events;");
  await sql("insert into public.query_runs(id,created_at,question,budget,data) select n::text,'2026-10-10T00:00:00Z','Synthetic',0,jsonb_build_object('usage',jsonb_build_object('fixture',repeat('x',1800))) from generate_series(1,6000) n;");
  await assert.rejects(rpc(), /usage_unavailable/); cases.push("run/payment/serialized-byte bounds refuse partial totals");
} catch (error) { failure = error; }
finally {
  if (containerId) {
    try {
      assert.match(containerId, /^[a-f0-9]{64}$/);
      assert.equal(await docker(["inspect", containerId, "--format", `{{.Id}} {{index .Config.Labels ${JSON.stringify(labelKey)}}}`]), `${containerId} ${fixtureId}`);
      await docker(["rm", "-f", containerId]); assert.equal(await docker(["ps", "-aq", "--filter", `id=${containerId}`]), "");
    } catch (error) { failure ??= error; }
  }
  assert.ok(resolve(config).startsWith(resolve(tmpdir()) + sep) && config.includes("keryx-public-usage-docker-")); rmSync(config, { recursive: true, force: true });
  for (const receipt of receipts) for (const channel of ["stdout", "stderr"]) assert.equal(hash(readFileSync(join(out, `${receipt.label}.${channel}.raw`))), receipt[`${channel}Sha256`]);
  const sourcePaths = ["supabase/migrations/0001_keryx_schema.sql", "supabase/migrations/0017_query_run_asker.sql", "supabase/migrations/0028_payment_settlement_state.sql", "supabase/migrations/0089_public_usage_window.sql", "lib/usage/contracts.ts", "lib/research/usage-provenance.ts", "lib/research/run-provenance.ts", "lib/research-audit/usage-cohort.ts", "lib/research-audit/usage-summary.ts", "lib/research-audit/exact-units.ts", "lib/db/public-usage-supabase.ts", "scripts/test-public-usage-postgres.mts", "test-support/public-usage-fixture-command.ts", "scripts/public-usage-fixture-command.test.ts", "tsconfig.public-usage.json", ".github/workflows/public-usage-postgres.yml"];
  writeFileSync(join(out, "acceptance.json"), JSON.stringify({ format: "keryx-ordinary-public-usage-postgres-acceptance-v1", accepted: !failure,
    syntheticOnly: true, productionMeasurements: false, nativeEnrollment: false, sharedDDL: false, operationalClearance: false,
    sourceCommit, serverVersion: version, imageId, cases, receipts, sourceHashes: Object.fromEntries(sourcePaths.map(file => [file, hash(readFileSync(file))])),
    failure: failure instanceof Error ? failure.message : failure ? String(failure) : null }, null, 2), { flag: "wx" });
}
if (failure) throw failure;
console.log(`Public usage PG17 actual acceptance passed: ${cases.length} cases; owned synthetic fixture removed; source-pinned raw receipts retained.`);
