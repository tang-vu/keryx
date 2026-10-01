/** Actual synthetic PostgreSQL17/PostgREST only; no application environment,
 * real wallet, provider RPC, funds or production activation. */
import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { browserQueryPolicyTypedData, verifyBrowserQueryPolicy, type BrowserQueryPolicy } from "../lib/payments/browser-query-policy";
import { browserSigningTypedData, serializeBrowserSigningHeader } from "../lib/payments/browser-signing-original";
import { prepareBrowserJournal } from "../lib/db/browser-authorization-journal";
import type { BrowserOriginalAdmission } from "../lib/db/browser-signing-originals";
import { admitSupabaseBrowserQueryPolicy, admitSupabaseBrowserSigningOriginal, readSupabaseBrowserSigningSnapshot, signSupabaseBrowserSigningOriginal } from "../lib/db/supabase-browser-signing-originals";

const name = `keryx-browser-originals-${randomUUID()}`, owned = [name, `${name}-http`, `${name}-curl`], created: string[] = [];
let engine = false;
const docker = (args: string[], input?: string) => execFileSync("docker", args, { input, encoding: "utf8", timeout: 60000, stdio: ["pipe", "pipe", "pipe"] });
const sql = (s: string) => docker(["exec", "-i", name, "psql", "-h", "127.0.0.1", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"], `set statement_timeout='30s';set lock_timeout='5s';${s}`).trim();
const json = (v: unknown) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
const digest = () => `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
const service = (s: string) => sql(`set role service_role;${s}`);
const start = (index: number, image: string, args: string[]) => {
  if (!created.includes(owned[index])) created.push(owned[index]);
  docker(["run", "-d", "--name", owned[index], ...args, image]);
};
const launchSidecars = () => {
  start(1, "postgrest/postgrest:v12.2.3", ["--network", `container:${name}`, "--memory", "256m", "-e", "PGRST_DB_URI=postgres://originals_http@127.0.0.1:5432/postgres", "-e", "PGRST_DB_ANON_ROLE=service_role", "-e", "PGRST_DB_SCHEMAS=public", "-e", "PGRST_DB_CONFIG=false", "-e", "PGRST_DB_POOL=4"]);
  if (!created.includes(owned[2])) created.push(owned[2]);
  docker(["run", "-d", "--name", owned[2], "--network", `container:${name}`, "--memory", "64m", "--entrypoint", "sh", "curlimages/curl:8.12.1", "-c", "sleep 900"]);
};
const readiness = async () => { const end = performance.now() + 10000; while (performance.now() < end) { try {
  execFileSync("docker", ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], { timeout: 2000, stdio: "ignore" }); return;
} catch { await new Promise(r => setTimeout(r, 100)); } } throw new Error("Synthetic PG startup deadline"); };
const http: typeof fetch = async (input, init) => {
  const path = new URL(String(input)).pathname.replace(/^\/rest\/v1/, ""); assert(/^\/rpc\/(browser_signing_[a-z_]+|sign_browser_journal)$/.test(path));
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile("docker", ["exec", "-i", owned[2], "curl", "--max-time", "10", "--silent", "--show-error", "--request", "POST", "--header", "Content-Type: application/json",
      "--data-binary", "@-", "--write-out", "\n%{http_code}", `http://127.0.0.1:3000${path}`], { encoding: "utf8", timeout: 15000 }, (error, out) => error ? reject(new Error("Synthetic PostgREST unavailable")) : resolve(out));
    child.stdin!.end(String(init?.body ?? "{}"));
  }); const index = output.lastIndexOf("\n"), status = Number(output.slice(index + 1)), body = output.slice(0, index);
  if (status >= 400) {
    // Fixture-only diagnostics: never print request bodies, proofs or headers.
    let code = "unknown", message = "unavailable";
    try {
      const error = JSON.parse(body) as { code?: unknown; message?: unknown };
      if (typeof error.code === "string" && /^[A-Z0-9]{5}$/.test(error.code)) code = error.code;
      if (typeof error.message === "string") message = error.message
        .replace(/0x[0-9a-f]+/gi, "[hex]").replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[uuid]")
        .replace(/"[^"\n]*"|'[^'\n]*'/g, "[quoted]").replace(/[\r\n\t]/g, " ").slice(0, 240);
    } catch { /* Non-JSON response remains redacted. */ }
    console.error(`Synthetic PostgREST ${path}: SQLSTATE=${code}; ${message}`);
  }
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
};
try {
  try { docker(["info", "--format", "{{.ServerVersion}}"]); engine = true; } catch { throw new Error("Actual browser originals PG acceptance requires Docker; gate did not run"); }
  start(0, "postgres:17", ["--network", "none", "--memory", "512m", "--cpus", "1", "-e", "POSTGRES_HOST_AUTH_METHOD=trust"]); await readiness();
  const migrations = readdirSync("supabase/migrations").filter(f => /^\d{4}.*\.sql$/.test(f) && Number(f.slice(0, 4)) <= 70).sort();
  assert(migrations.includes("0070_browser_signing_originals.sql"));
  sql("create role anon;create role authenticated;create role service_role bypassrls;create publication supabase_realtime;" + migrations.map(f => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n"));
  assert.equal(sql("select active from public.browser_signing_v2_control"), "f", "installed migration remains inactive");
  const owner = privateKeyToAccount(generatePrivateKey()), signer = privateKeyToAccount(generatePrivateKey()), epoch = randomUUID();
  const grant = (grantEpoch: string) => service(`select public.upsert_browser_journal_grant(${json({ session_id: "synthetic-owner", owner_addr: owner.address.toLowerCase(), sess_addr: signer.address.toLowerCase(), cap: 0.000010, expiry: Date.now() + 3600000, tx_hash: "synthetic-unfunded", grant_epoch: grantEpoch })})`);
  service("select public.activate_browser_journal()"); grant(epoch);
  const makeInput = (namespace: string, queryId: string, grantEpoch: string = epoch, requestId: string = randomUUID()): BrowserOriginalAdmission => {
    const payee = `0x${"4".repeat(40)}`, gateway = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
    return { queryNamespace: namespace, queryId, journal: { sessionId: "synthetic-owner", requestId, queryId, grantEpoch, signer: signer.address.toLowerCase(),
      network: "eip155:5042002", token: "0x3600000000000000000000000000000000000000", gatewayContract: gateway, sourceId: "synthetic-source", offerId: null, kind: "fetch", payee, amountMicroUsdc: 1,
      requirements: { scheme: "exact", network: "eip155:5042002", asset: "0x3600000000000000000000000000000000000000", payTo: payee, amount: "1", maxTimeoutSeconds: 604900,
        extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: gateway } },
      payment: { kind: "fetch", queryId, sourceId: "synthetic-source", sourceName: "Synthetic", payer: signer.address.toLowerCase(), payee, amountUsdc: 0.000001, network: "eip155:5042002", grantEpoch, origin: "web" } } };
  };
  const legacy = makeInput(`0x${"0".repeat(64)}`, randomUUID(), epoch, "legacy-request"), legacyJournal = prepareBrowserJournal(legacy.journal), a = legacy.journal;
  const legacyIntent = { nonce: legacyJournal.nonce, session_id: a.sessionId, request_id: a.requestId, query_id: a.queryId, grant_epoch: a.grantEpoch, signer: a.signer, network: a.network, token: a.token,
    gateway_contract: a.gatewayContract, source_id: a.sourceId, offer_id: a.offerId, kind: a.kind, payee: a.payee, amount_micro_usdc: a.amountMicroUsdc, created_at: legacyJournal.admittedAt };
  assert.equal(service(`select public.admit_browser_journal(${json(legacyIntent)},${json(legacyJournal.requirements)},${json(legacyJournal.payment)})`), "admitted");
  const retainedLegacy = sql(`select to_jsonb(i) from public.browser_authorization_intents i where nonce='${legacyJournal.nonce}'`);
  sql("create role originals_http login;alter role originals_http set statement_timeout='10s';grant service_role to originals_http");
  launchSidecars();
  const sb = createClient("http://synthetic.invalid", "synthetic-no-authority", { auth: { persistSession: false }, global: { fetch: http } });
  const policy: BrowserQueryPolicy = { protocol: "durable-v2", service: "https://keryx.cc", owner: owner.address.toLowerCase() as `0x${string}`, signer: signer.address.toLowerCase() as `0x${string}`, policyId: digest(), grantEpoch: epoch,
    requestNonce: digest(), queryId: randomUUID(), questionDigest: digest(), queryCeilingMicros: "2", lifetimeCeilingMicros: "4", jobLimit: 2, expiresAt: Date.now() + 600000 };
  const proof = { policy, signature: await owner.signTypedData(browserQueryPolicyTypedData(policy)) }, verified = await verifyBrowserQueryPolicy(proof);
  let httpReady = false;
  for (let i = 0; i < 20; i++) { try { assert.equal((await admitSupabaseBrowserQueryPolicy(sb, proof, "synthetic-owner")).status, "inactive"); httpReady = true; break; } catch { await new Promise(r => setTimeout(r, 200)); } } assert(httpReady);
  sql("update public.browser_signing_v2_control set active=true where id=1");
  sql("update public.browser_journal_control set active=false where id=1");
  assert.equal((await admitSupabaseBrowserQueryPolicy(sb, proof, "synthetic-owner")).status, "inactive", "v2 alone cannot enable base journal admission");
  assert.equal(sql("select count(*) from public.browser_signing_namespaces"), "0");
  sql("update public.browser_journal_control set active=true where id=1");
  assert.throws(() => service(`select public.admit_browser_journal(${json({ ...legacyIntent, nonce: digest(), request_id: "old-fresh" })},${json(legacyJournal.requirements)},${json(legacyJournal.payment)})`), /browser signing v2 original required/);
  assert.deepEqual(await admitSupabaseBrowserQueryPolicy(sb, proof, "synthetic-owner"), { status: "admitted", namespace: verified.namespace, queryId: policy.queryId });
  const snapshot = () => sql(`select jsonb_build_object('namespaces',(select jsonb_agg(to_jsonb(n) order by namespace) from public.browser_signing_namespaces n),
    'policies',(select jsonb_agg(to_jsonb(p) order by namespace,policy_id) from public.browser_signing_policies p),'queries',(select jsonb_agg(to_jsonb(q) order by namespace,query_id) from public.browser_signing_queries q),
    'originals',(select jsonb_agg(to_jsonb(o) order by nonce) from public.browser_signing_originals o),'intents',(select jsonb_agg(to_jsonb(i) order by nonce) from public.browser_authorization_intents i),
    'bindings',(select jsonb_agg(to_jsonb(b) order by nonce) from public.browser_journal_bindings b),'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.payment_events p),
    'grants',(select jsonb_agg(to_jsonb(g) order by session_id) from public.session_grants g),'signers',(select jsonb_agg(to_jsonb(c) order by signer) from public.browser_signer_capacity c),
    'epochs',(select jsonb_agg(to_jsonb(r) order by grant_epoch) from public.browser_retained_grants r))`);
  const unchanged = async (fn: () => Promise<void>) => { const before = snapshot(); await fn(); assert.equal(snapshot(), before); assert.equal(sql("select count(*) from public.browser_signing_v2_writer"), "0"); assert.equal(sql("select count(*) from public.browser_journal_writer"), "0"); };
  for (const excess of [{ ...policy, policyId: digest(), requestNonce: digest(), queryId: randomUUID(), expiresAt: Number(sql("select expiry from public.session_grants where session_id='synthetic-owner'")) + 1 },
    { ...policy, policyId: digest(), requestNonce: digest(), queryId: randomUUID(), lifetimeCeilingMicros: "11" }]) await unchanged(async () => {
    const excessProof = { policy: excess, signature: await owner.signTypedData(browserQueryPolicyTypedData(excess)) };
    assert.equal((await admitSupabaseBrowserQueryPolicy(sb, excessProof, "synthetic-owner")).status, "refused");
  });
  const input = makeInput(verified.namespace, policy.queryId), race = await Promise.all([admitSupabaseBrowserSigningOriginal(sb, input), admitSupabaseBrowserSigningOriginal(sb, input)]);
  assert(race.every(r => r.status === "admitted")); assert.equal(sql("select count(*) from public.browser_signing_originals"), "1");
  if (race[0].status !== "admitted" || race[1].status !== "admitted") throw new Error("Synthetic admission refused"); assert.deepEqual(race[0].original, race[1].original);
  const competing = await Promise.all([admitSupabaseBrowserSigningOriginal(sb, makeInput(verified.namespace, policy.queryId)), admitSupabaseBrowserSigningOriginal(sb, makeInput(verified.namespace, policy.queryId))]);
  assert.equal(competing.filter(r => r.status === "admitted").length, 1); assert.equal(competing.filter(r => r.status === "refused").length, 1);
  assert.equal(sql("select spent_micro from public.browser_signing_queries"), "2"); assert.equal(sql("select spent_micro from public.browser_signer_capacity"), "3");
  for (const tamper of ["update public.browser_signing_queries set spent_micro=1", "delete from public.browser_signing_queries", "delete from public.browser_signing_originals",
    "update public.browser_signing_v2_control set active=false", "delete from public.browser_signing_v2_control", "delete from public.browser_signing_v2_barrier"]) {
    await unchanged(async () => { assert.throws(() => sql(tamper), /monotonic|retained/); });
  }
  await unchanged(async () => { assert.equal((await admitSupabaseBrowserQueryPolicy(sb, proof, "synthetic-owner")).status, "admitted"); assert.equal((await admitSupabaseBrowserSigningOriginal(sb, input)).status, "admitted"); });
  await unchanged(async () => { await assert.rejects(() => admitSupabaseBrowserSigningOriginal(sb, { ...input, journal: { ...input.journal, payee: `0x${"5".repeat(40)}` } })); });
  const saved = await readSupabaseBrowserSigningSnapshot(sb, policy.owner, input.journal.sessionId, input.journal.requestId); assert(saved);
  await unchanged(async () => { assert.equal(await readSupabaseBrowserSigningSnapshot(sb, signer.address, input.journal.sessionId, input.journal.requestId), null); });
  service(`select public.transition_browser_journal('synthetic-owner','${input.journal.requestId}','prepared','exposed')`);
  await unchanged(async () => { assert.throws(() => service(`select public.sign_browser_journal('synthetic-owner','${input.journal.requestId}',${json({ validAfter: saved.original.authorization.validAfter, validBefore: saved.original.authorization.validBefore, headerHash: "f".repeat(64) })})`), /canonical callback required/); });
  await unchanged(async () => { assert.throws(() => service(`select public.browser_signing_record_signature('synthetic-owner','${input.journal.requestId}',${json({ validAfter: saved.original.authorization.validAfter, validBefore: String(BigInt(saved.original.authorization.validBefore) + 1n), headerHash: "f".repeat(64) })})`), /original validity differs/); });
  const header = serializeBrowserSigningHeader(saved.original, await signer.signTypedData(browserSigningTypedData(saved.original)));
  assert.equal(await signSupabaseBrowserSigningOriginal(sb, input.journal.sessionId, input.journal.requestId, header), true);
  service(`select public.transition_browser_journal('synthetic-owner','legacy-request','prepared','exposed');select public.sign_browser_journal('synthetic-owner','legacy-request',${json({ validAfter: "0", validBefore: "2000000000", headerHash: "e".repeat(64) })})`);
  assert.equal(sql(`select to_jsonb(i) from public.browser_authorization_intents i where nonce='${legacyJournal.nonce}'`), retainedLegacy);
  assert.equal(await signSupabaseBrowserSigningOriginal(sb, "synthetic-owner", "legacy-request", "untrusted"), false);
  sql("update public.browser_journal_control set active=false where id=1");
  await unchanged(async () => {
    assert.equal((await readSupabaseBrowserSigningSnapshot(sb, policy.owner, input.journal.sessionId, input.journal.requestId))?.active, false);
    assert.equal((await admitSupabaseBrowserQueryPolicy(sb, proof, "synthetic-owner")).status, "inactive");
    assert.equal((await admitSupabaseBrowserSigningOriginal(sb, makeInput(verified.namespace, policy.queryId))).status, "inactive");
    assert.equal(service(`select public.sign_browser_journal('synthetic-owner','legacy-request',${json({ validAfter: "0", validBefore: "2000000000", headerHash: "e".repeat(64) })})`), "t", "historical legacy callback remains available while paused");
  });
  sql("update public.browser_journal_control set active=true where id=1");
  console.log("PASS actual journal composition/races/caps/immutable original/header/legacy callback");
  const replacementEpoch = randomUUID(); grant(replacementEpoch);
  await unchanged(async () => { assert.equal((await admitSupabaseBrowserQueryPolicy(sb, proof, "synthetic-owner")).status, "admitted"); assert.equal((await admitSupabaseBrowserSigningOriginal(sb, makeInput(verified.namespace, policy.queryId))).status, "refused"); });
  const secondPolicy = { ...policy, policyId: digest(), requestNonce: digest(), queryId: randomUUID(), grantEpoch: replacementEpoch, queryCeilingMicros: "1", lifetimeCeilingMicros: "5" };
  const secondProof = { policy: secondPolicy, signature: await owner.signTypedData(browserQueryPolicyTypedData(secondPolicy)) };
  assert.equal((await admitSupabaseBrowserQueryPolicy(sb, secondProof, "synthetic-owner")).status, "admitted");
  assert.equal(sql("select allocated_micro||':'||jobs from public.browser_signing_namespaces"), "3:2");
  const current = await readSupabaseBrowserSigningSnapshot(sb, policy.owner, input.journal.sessionId, input.journal.requestId); assert(current);
  assert.equal(current.namespace.ceilingMicros, "5", "later approval sets an absolute signed ceiling, never adds to the earlier four");
  assert.equal(current.namespace.ceilingProof.policy.policyId, secondPolicy.policyId, "old query reads current namespace's signed absolute ceiling proof");
  sql(`create function public.synthetic_original_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic original rollback'; end$$;
    create trigger synthetic_original_failure before insert on public.browser_signing_originals for each row execute function public.synthetic_original_failure()`);
  await unchanged(async () => { await assert.rejects(() => admitSupabaseBrowserSigningOriginal(sb, makeInput(verified.namespace, secondPolicy.queryId, replacementEpoch))); });
  sql("drop trigger synthetic_original_failure on public.browser_signing_originals;drop function public.synthetic_original_failure()");
  console.log("PASS late original failure atomically rolls back existing journal/caps/query/writer capability");
  const latestEpoch = randomUUID(); grant(latestEpoch);
  assert.equal(sql(`select spent_micro from public.browser_signing_queries where query_id='${secondPolicy.queryId}'`), "0");
  await unchanged(async () => {
    assert.equal((await admitSupabaseBrowserQueryPolicy(sb, secondProof, "synthetic-owner")).status, "admitted", "old proof replay is observation, not fresh epoch permission");
    assert.equal((await admitSupabaseBrowserSigningOriginal(sb, makeInput(verified.namespace, secondPolicy.queryId, replacementEpoch))).status, "refused", "changed current epoch refuses despite unused query capacity");
  });
  for (const changed of [{ ...secondPolicy, policyId: digest(), requestNonce: policy.requestNonce, queryId: randomUUID() }, { ...secondPolicy, questionDigest: digest() }]) await unchanged(async () => {
    const signature = await owner.signTypedData(browserQueryPolicyTypedData(changed));
    await assert.rejects(() => admitSupabaseBrowserQueryPolicy(sb, { policy: changed, signature }, "synthetic-owner"));
  });
  const third = { ...secondPolicy, policyId: digest(), requestNonce: digest(), queryId: randomUUID(), grantEpoch: latestEpoch };
  await unchanged(async () => { assert.equal((await admitSupabaseBrowserQueryPolicy(sb, { policy: third, signature: await owner.signTypedData(browserQueryPolicyTypedData(third)) }, "synthetic-owner")).status, "refused"); });
  const cancelled = competing.find(r => r.status === "admitted"); assert(cancelled?.status === "admitted");
  service(`select public.terminal_browser_journal('x402:${cancelled.journal.nonce}','${cancelled.journal.nonce}',null,'cancelled_unexposed')`);
  assert.equal(sql("select spent_micro from public.browser_signing_queries where query_id='" + policy.queryId + "'"), "2"); assert.equal(sql("select allocated_micro||':'||jobs from public.browser_signing_namespaces"), "3:2");
  console.log("PASS policy/epoch aliases retain lifetime query allocation/jobs/spent without release");
  for (const role of ["anon", "authenticated"] as const) for (const rpc of [`select public.browser_signing_admit_query(${json(verified)},'synthetic-owner')`, `select public.browser_signing_admit_original('{}','{}','{}')`,
    `select public.browser_signing_record_signature('synthetic-owner','${input.journal.requestId}','{}')`, `select public.browser_signing_header_original('synthetic-owner','${input.journal.requestId}')`, `select public.browser_signing_snapshot('${policy.owner}','synthetic-owner','${input.journal.requestId}')`]) {
    await unchanged(async () => { assert.throws(() => sql(`set role ${role};${rpc}`), /permission denied/); });
  }
  for (const table of ["browser_signing_v2_control", "browser_signing_v2_writer", "browser_signing_v2_barrier", "browser_signing_namespaces", "browser_signing_policies", "browser_signing_queries", "browser_signing_originals"]) {
    await unchanged(async () => { assert.throws(() => service(`delete from public.${table}`), /permission denied/); });
  }
  const beforeRestart = snapshot(); docker(["restart", name]); await readiness();
  // Rejoin both stateless sidecars to the restarted DB's network namespace.
  // This checks durable readback, not untouched pool/client auto-reconnection.
  docker(["rm", "-f", owned[2], owned[1]]); launchSidecars();
  let restartedHttpReady = false; const restartDeadline = performance.now() + 10000;
  while (performance.now() < restartDeadline) {
    try {
      const observed = await readSupabaseBrowserSigningSnapshot(sb, policy.owner, input.journal.sessionId, input.journal.requestId);
      if (observed !== null) { restartedHttpReady = true; break; }
    } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  assert(restartedHttpReady, "Synthetic PostgREST restart readiness deadline");
  assert.equal(snapshot(), beforeRestart); await unchanged(async () => { const recovered = await readSupabaseBrowserSigningSnapshot(sb, policy.owner, input.journal.sessionId, input.journal.requestId); assert.deepEqual(recovered?.original, saved.original); });
} finally {
  if (engine) {
    let failures = 0; const existing = docker(["ps", "-a", "--format", "{{.Names}}"]).trim().split("\n");
    for (const container of created.reverse()) if (existing.includes(container)) { try { docker(["rm", "-f", "-v", container]); } catch { failures++; } }
    assert.deepEqual(docker(["ps", "-a", "--format", "{{.Names}}"]).trim().split("\n").filter(n => owned.includes(n)), []); assert.equal(failures, 0);
  }
}
console.log("PASS actual role ACL/direct-write refusal/DB+HTTP restart coherent readback/owned cleanup; synthetic only");
