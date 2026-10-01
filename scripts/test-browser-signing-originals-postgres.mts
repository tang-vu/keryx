/** Actual synthetic PostgreSQL17/PostgREST only; no application environment,
 * real wallet, provider RPC, funds or production activation. */
import assert from "node:assert/strict";
import { execFile, execFileSync, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { readFileSync, readdirSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { decodeFunctionData, encodeFunctionResult, toHex } from "viem";
import { REGISTRY_ABI } from "../lib/registry/registry-client";
import { createSyntheticBrowserOriginalSourceAuthority, prepareBrowserSourceSigningAdmission, assertVerifiedBrowserOriginalSourceContextCurrent } from "../lib/payments/browser-original-source-authority";
import { browserSourceRegistryId } from "../lib/payments/browser-original-source-context";
import { sourceItemContentVersion } from "../lib/sources/source-item-asset";
import { articleOfferTypedData, articleOfferId } from "../lib/offers/article-offer-proof";
import { prepareBrowserSourceSigningOriginal } from "../lib/payments/browser-signing-original";
import type { Source, SourceItem, ArticleOffer } from "../lib/types";
import { browserQueryPolicyTypedData, verifyBrowserQueryPolicy, type BrowserQueryPolicy } from "../lib/payments/browser-query-policy";
import { browserSigningTypedData, serializeBrowserSigningHeader } from "../lib/payments/browser-signing-original";
import { prepareBrowserJournal } from "../lib/db/browser-authorization-journal";
import type { BrowserOriginalAdmission, BrowserSourceOriginalAdmission } from "../lib/db/browser-signing-originals";
import { admitSupabaseBrowserQueryPolicy, admitSupabaseBrowserSigningOriginal, admitSupabaseBrowserSourceSigningOriginal, readSupabaseBrowserSigningSnapshot, readExposedSupabaseBrowserSigningSnapshotForSigner, signSupabaseBrowserSigningOriginal } from "../lib/db/supabase-browser-signing-originals";

const name = `keryx-browser-originals-${randomUUID()}`, owned = [name, `${name}-http`, `${name}-curl`], created: string[] = [];
let engine = false;
let sourceRpc: Server | undefined;
const sqlSessions = new Set<ChildProcess>();
const docker = (args: string[], input?: string) => execFileSync("docker", args, { input, encoding: "utf8", timeout: 60000, stdio: ["pipe", "pipe", "pipe"] });
const sql = (s: string, database = "postgres") => docker(["exec", "-i", name, "psql", "-h", "127.0.0.1", "-U", "postgres", "--dbname", database, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"], `set statement_timeout='30s';set lock_timeout='5s';${s}`).trim();
const json = (v: unknown) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
const digest = () => `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
const service = (s: string) => sql(`set role service_role;${s}`);
async function transaction(initial: string, database = "postgres") {
  const child = execFile("docker", ["exec", "-i", name, "psql", "-h", "127.0.0.1", "-U", "postgres", "--dbname", database, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"], { encoding: "utf8", timeout: 20000 });
  sqlSessions.add(child); let output = "", errors = "";
  child.stdout!.on("data", value => { output += value; }); child.stderr!.on("data", value => { errors += value; });
  const command = async (statement: string) => {
    const marker = randomUUID(); child.stdin!.write(`${statement};select '${marker}';\n`);
    const deadline = performance.now() + 5000;
    while (!output.includes(marker) && child.exitCode === null && performance.now() < deadline) await new Promise(r => setTimeout(r, 20));
    if (!output.includes(marker)) throw new Error(/^.*40001.*$/ms.test(errors) ? "Synthetic SQLSTATE40001" : "Synthetic SQL transaction command refused");
  };
  await command(`\\set VERBOSITY sqlstate\nset statement_timeout='5s';set idle_in_transaction_session_timeout='10s';${initial}`);
  return { command, close: async () => { if (child.exitCode === null) { child.stdin!.end("rollback;\n"); await once(child, "exit"); } sqlSessions.delete(child); } };
}
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
  const migrations = readdirSync("supabase/migrations").filter(f => /^\d{4}.*\.sql$/.test(f) && Number(f.slice(0, 4)) <= 72).sort();
  assert(migrations.includes("0070_browser_signing_originals.sql"));
  assert(migrations.includes("0071_browser_original_observation.sql"));
  assert(migrations.includes("0072_browser_source_context.sql"));
  sql("create role anon;create role authenticated;create role service_role bypassrls;create publication supabase_realtime;" + migrations.map(f => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n"));
  assert.equal(sql("select active from public.browser_signing_v2_control"), "f", "installed migration remains inactive");
  assert.equal(sql("select min_original_version from public.browser_signing_v2_control"), "2");
  assert.throws(() => sql("delete from public.browser_signing_v2_control"), /activation is retained/, "even inactive floor2 control cannot be deleted and reinserted around the guard");
  assert.throws(() => sql("insert into public.browser_signing_v2_control values(1,true,3)"), /base journal inactive/, "INSERT activation is guarded before any barrier change");
  assert.equal(sql("select count(*) from public.browser_signing_v2_barrier"), "0");
  assert.equal(sql("select provolatile='s' and prosecdef and not exists(select 1 from aclexplode(proacl) a where a.grantee=0 and a.privilege_type='EXECUTE') from pg_proc where oid='public.browser_signing_exposed_snapshot_for_signer(text,text,text)'::regprocedure"), "t", "STABLE protected observation has no PUBLIC execute privilege");
  const owner = privateKeyToAccount(generatePrivateKey()), signer = privateKeyToAccount(generatePrivateKey()), epoch = randomUUID();
  const grant = (grantEpoch: string, cap = 0.000010) => service(`select public.upsert_browser_journal_grant(${json({ session_id: "synthetic-owner", owner_addr: owner.address.toLowerCase(), sess_addr: signer.address.toLowerCase(), cap, expiry: Date.now() + 3600000, tx_hash: "synthetic-unfunded", grant_epoch: grantEpoch })})`);
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
  const snapshot = (database = "postgres") => sql(`select jsonb_build_object('namespaces',(select jsonb_agg(to_jsonb(n) order by namespace) from public.browser_signing_namespaces n),
    'policies',(select jsonb_agg(to_jsonb(p) order by namespace,policy_id) from public.browser_signing_policies p),'queries',(select jsonb_agg(to_jsonb(q) order by namespace,query_id) from public.browser_signing_queries q),
    'originals',(select jsonb_agg(to_jsonb(o) order by nonce) from public.browser_signing_originals o),'intents',(select jsonb_agg(to_jsonb(i) order by nonce) from public.browser_authorization_intents i),
    'bindings',(select jsonb_agg(to_jsonb(b) order by nonce) from public.browser_journal_bindings b),'payments',(select jsonb_agg(to_jsonb(p) order by id) from public.payment_events p),
    'grants',(select jsonb_agg(to_jsonb(g) order by session_id) from public.session_grants g),'signers',(select jsonb_agg(to_jsonb(c) order by signer) from public.browser_signer_capacity c),
    'epochs',(select jsonb_agg(to_jsonb(r) order by grant_epoch) from public.browser_retained_grants r),
    'control',(select jsonb_agg(to_jsonb(c)) from public.browser_signing_v2_control c),'barrier',(select jsonb_agg(to_jsonb(b)) from public.browser_signing_v2_barrier b),
    'sources',(select jsonb_agg(to_jsonb(s) order by id) from public.sources s),'items',(select jsonb_agg(to_jsonb(i) order by id) from public.source_items i),
    'offers',(select jsonb_agg(to_jsonb(o) order by id) from public.article_offers o))`, database);
  const unchanged = async (fn: () => Promise<void>) => { const before = snapshot(); await fn(); assert.equal(snapshot(), before); assert.equal(sql("select count(*) from public.browser_signing_v2_writer"), "0"); assert.equal(sql("select count(*) from public.browser_signing_v3_writer"), "0"); assert.equal(sql("select count(*) from public.browser_journal_writer"), "0"); };
  const dormantInput: BrowserSourceOriginalAdmission = { ...makeInput(verified.namespace, policy.queryId), protocol: "durable-v3", source: { sourceId: "synthetic-source", itemId: "synthetic-item", contentVersion: "synthetic-version", offerId: null } };
  dormantInput.journal.payment.itemId = dormantInput.source.itemId; dormantInput.journal.payment.contentVersion = dormantInput.source.contentVersion;
  let dormantResolutions = 0;
  await unchanged(async () => { assert.equal((await admitSupabaseBrowserSourceSigningOriginal(sb, dormantInput, { async resolve(): Promise<never> { dormantResolutions++; throw new Error("Inactive must not resolve a provider"); } })).status, "inactive"); });
  assert.equal(dormantResolutions, 0, "floor2 inactive v3 is refused before any registry/provider resolution");
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
  const observe = (requestId = input.journal.requestId, recoveredSigner = signer.address) => readExposedSupabaseBrowserSigningSnapshotForSigner(sb, recoveredSigner, input.journal.sessionId, requestId);
  await unchanged(async () => {
    assert.equal(await observe(), null, "prepared tuple never leaves signer reader");
    assert.equal(service(`select public.browser_signing_exposed_snapshot_for_signer('${signer.address}','synthetic-owner','${input.journal.requestId}') is null`), "t");
    assert.equal(await observe("absent-request"), null);
  });
  await unchanged(async () => { assert.equal(await readSupabaseBrowserSigningSnapshot(sb, signer.address, input.journal.sessionId, input.journal.requestId), null); });
  service(`select public.transition_browser_journal('synthetic-owner','${input.journal.requestId}','prepared','exposed')`);
  await unchanged(async () => {
    assert.deepEqual((await observe())?.original, saved.original);
    assert.equal(await observe(input.journal.requestId, owner.address), null, "owner address is not signer authority");
    assert.equal(service(`select public.browser_signing_exposed_snapshot_for_signer('${owner.address}','synthetic-owner','${input.journal.requestId}') is null`), "t");
  });
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
  await unchanged(async () => { assert.equal((await observe())?.journal.grantEpoch, epoch); assert.equal((await observe())?.currentGrant?.grantEpoch, replacementEpoch); });
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
  await unchanged(async () => {
    assert.equal(await observe(cancelled.journal.requestId), null);
    assert.equal(service(`select public.browser_signing_exposed_snapshot_for_signer('${signer.address}','synthetic-owner','${cancelled.journal.requestId}') is null`), "t");
  });
  service(`select public.disable_browser_journal_grant('synthetic-owner')`);
  await unchanged(async () => { assert.deepEqual((await observe())?.original, saved.original); });
  service(`select public.terminal_browser_journal('x402:${saved.journal.nonce}','${saved.journal.nonce}','synthetic-terminal-proof','failed')`);
  await unchanged(async () => { const terminal = await observe(); assert.equal(terminal?.journal.phase, "failed"); assert.deepEqual(terminal?.original, saved.original); });
  console.log("PASS signer-only exposed/historical failed observation; prepared/cancelled/foreign return null; whole state unchanged by reads");
  assert.equal(sql("select spent_micro from public.browser_signing_queries where query_id='" + policy.queryId + "'"), "2"); assert.equal(sql("select allocated_micro||':'||jobs from public.browser_signing_namespaces"), "3:2");
  console.log("PASS policy/epoch aliases retain lifetime query allocation/jobs/spent without release");
  const sourceEpoch = randomUUID(); grant(sourceEpoch);
  const sourcePolicy = { ...policy, policyId: digest(), requestNonce: digest(), queryId: randomUUID(), grantEpoch: sourceEpoch, queryCeilingMicros: "4", lifetimeCeilingMicros: "7", jobLimit: 3 };
  assert.equal((await admitSupabaseBrowserQueryPolicy(sb, { policy: sourcePolicy, signature: await owner.signTypedData(browserQueryPolicyTypedData(sourcePolicy)) }, "synthetic-owner")).status, "admitted");
  const preparedOldInput = makeInput(verified.namespace, sourcePolicy.queryId, sourceEpoch), exposedOldInput = makeInput(verified.namespace, sourcePolicy.queryId, sourceEpoch);
  const preparedOld = await admitSupabaseBrowserSigningOriginal(sb, preparedOldInput), exposedOld = await admitSupabaseBrowserSigningOriginal(sb, exposedOldInput);
  assert(preparedOld.status === "admitted" && exposedOld.status === "admitted");
  const retainedV2 = sql(`select original::text from public.browser_signing_originals where nonce='${exposedOld.journal.nonce}'`);
  service(`select public.transition_browser_journal('synthetic-owner','${exposedOld.journal.requestId}','prepared','exposed')`);
  const holdingInput = makeInput(verified.namespace, sourcePolicy.queryId, sourceEpoch), holdingJournal = prepareBrowserJournal(holdingInput.journal);
  const holdingOriginal = (await import("../lib/payments/browser-signing-original")).prepareBrowserSigningOriginal(holdingJournal, verified.namespace);
  const held = await transaction(`begin;set role service_role;select public.browser_signing_admit_original(${json(holdingInput)},${json(holdingJournal)},${json(holdingOriginal)})`);
  assert.throws(() => sql("set lock_timeout='200ms';update public.browser_signing_v2_control set min_original_version=3 where id=1"), /lock timeout/, "a real old writer holds the floor until transaction completion");
  await held.close();
  const staleFresh = await transaction("begin isolation level repeatable read;select min_original_version from public.browser_signing_v2_barrier;set role service_role");
  const staleExposure = await transaction("begin isolation level repeatable read;select min_original_version from public.browser_signing_v2_barrier;set role service_role");
  sql("update public.browser_journal_control set active=false where id=1");
  await unchanged(async () => { assert.throws(() => sql("update public.browser_signing_v2_control set min_original_version=3 where id=1"), /base journal inactive/); });
  sql("update public.browser_journal_control set active=true where id=1;update public.browser_signing_v2_control set min_original_version=3 where id=1");
  await unchanged(async () => {
    await assert.rejects(() => staleFresh.command(`select public.browser_signing_admit_original(${json(holdingInput)},${json(holdingJournal)},${json(holdingOriginal)})`), /SQLSTATE40001/);
    await assert.rejects(() => staleExposure.command(`select public.transition_browser_journal('synthetic-owner','${preparedOld.journal.requestId}','prepared','exposed')`), /SQLSTATE40001/);
  });
  await staleFresh.close(); await staleExposure.close();
  for (const rollback of ["update public.browser_signing_v2_control set min_original_version=2", "delete from public.browser_signing_v2_control", "update public.browser_signing_v2_barrier set min_original_version=2", "delete from public.browser_signing_v2_barrier",
    "insert into public.browser_signing_v2_control values(1,true,2)"]) await unchanged(async () => { assert.throws(() => sql(rollback), /retained|minimum/); });
  await unchanged(async () => {
    assert.equal((await admitSupabaseBrowserSigningOriginal(sb, holdingInput)).status, "refused", "literal old original RPC refuses after floor activation/rollback attempts");
    assert.throws(() => service(`select public.transition_browser_journal('synthetic-owner','${preparedOld.journal.requestId}','prepared','exposed')`), /v3 source exposure/);
  });
  const historicalHeader = serializeBrowserSigningHeader(exposedOld.original, await signer.signTypedData(browserSigningTypedData(exposedOld.original)));
  assert.equal(await signSupabaseBrowserSigningOriginal(sb, "synthetic-owner", exposedOld.journal.requestId, historicalHeader), true, "already exposed v2 first canonical callback survives floor upgrade");
  assert.equal(sql(`select original::text from public.browser_signing_originals where nonce='${exposedOld.journal.nonce}'`), retainedV2, "historical v2 bytes have no context backfill");
  service(`select public.terminal_browser_journal('x402:${preparedOld.journal.nonce}','${preparedOld.journal.nonce}',null,'cancelled_unexposed')`);
  console.log("PASS retained v3 floor/stale RR40001/old-writer activation serialization/rollback refusal/prepared exposure fence/exposed v2 first callback");

  const sourceUrl = "https://synthetic.invalid/source", registry = `0x${"5".repeat(40)}`, registryId = browserSourceRegistryId(owner.address, sourceUrl);
  sql(`insert into public.sources(id,name,url,wallet_address,fetch_price,onchain_id,active,verified) values('synthetic-source','Synthetic', '${sourceUrl}','${exposedOldInput.journal.payee}',0.000001,'${registryId}',true,true);
    insert into public.source_items(id,source_id,title,summary,content,link) values('synthetic-item','synthetic-source','Fixture','Synthetic preview','Synthetic generated fixture body','${sourceUrl}/item')`);
  const catalog = {
    async getSource(id: string): Promise<Source | null> { assert.equal(id, "synthetic-source"); return JSON.parse(sql("select jsonb_build_object('id',id,'name',name,'url',url,'description',description,'walletAddress',wallet_address,'fetchPrice',fetch_price,'tags',tags,'authors',authors,'createdAt',created_at,'onchainId',onchain_id,'active',active,'verified',verified) from public.sources where id='synthetic-source'")); },
    async getItem(sourceId: string, id: string): Promise<SourceItem | null> { assert.equal(sourceId, "synthetic-source"); assert.equal(id, "synthetic-item"); return JSON.parse(sql("select jsonb_build_object('id',id,'sourceId',source_id,'title',title,'summary',summary,'content',content,'link',link) from public.source_items where id='synthetic-item'")); },
    async getArticleOffer(sourceId: string, itemId: string): Promise<ArticleOffer | null> { assert.equal(sourceId, "synthetic-source"); assert.equal(itemId, "synthetic-item"); const value = sql("select jsonb_build_object('id',id,'sourceId',source_id,'itemId',item_id,'contentVersion',content_version,'priceUsdc6',price_usdc6,'expiresAt',expires_at,'signer',signer,'nonce',nonce,'signature',signature,'createdAt',created_at) from public.article_offers where source_id='synthetic-source' and item_id='synthetic-item'"); return value ? JSON.parse(value) : null; },
  };
  const sourceItem = await catalog.getItem("synthetic-source", "synthetic-item"); assert(sourceItem);
  const publicInput: BrowserSourceOriginalAdmission = { ...makeInput(verified.namespace, sourcePolicy.queryId, sourceEpoch), protocol: "durable-v3",
    source: { sourceId: "synthetic-source", itemId: sourceItem.id, contentVersion: sourceItemContentVersion(sourceItem), offerId: null } };
  publicInput.journal.payment.itemId = sourceItem.id; publicInput.journal.payment.contentVersion = publicInput.source.contentVersion;
  const rpcFailures: string[] = [], counts = new Map<string, number>(), blockHash = digest(), parentHash = digest(), blockTimestamp = Math.floor(Date.now() / 1000) - 1;
  const registryState = { height: 1n, hash: blockHash, price: 1n };
  sourceRpc = createServer(async (request, response) => {
    try {
      assert.equal(request.method, "POST"); let body = "";
      for await (const chunk of request) { body += chunk; assert(Buffer.byteLength(body) <= 8192); }
      const rpc = JSON.parse(body); assert(!Array.isArray(rpc)); counts.set(rpc.method, (counts.get(rpc.method) ?? 0) + 1);
      let result: unknown;
      if (rpc.method === "eth_chainId") result = toHex(5042002);
      else if (rpc.method === "eth_getBlockByNumber") {
        assert(["latest", toHex(registryState.height)].includes(rpc.params[0])); result = { number: toHex(registryState.height), hash: registryState.hash, timestamp: toHex(blockTimestamp), transactions: [], parentHash, gasLimit: "0x100000", gasUsed: "0x0", extraData: "0x", miner: registry, size: "0x1" };
      } else if (rpc.method === "eth_call") {
        assert.equal(rpc.params[1], toHex(registryState.height)); assert.equal(rpc.params[0].to.toLowerCase(), registry);
        const call = decodeFunctionData({ abi: REGISTRY_ABI, data: rpc.params[0].data }); assert.equal(call.functionName, "get"); assert.deepEqual(call.args, [registryId]);
        result = encodeFunctionResult({ abi: REGISTRY_ABI, functionName: "get", result: { creator: owner.address, payoutWallet: exposedOldInput.journal.payee as `0x${string}`, authors: [], fetchPriceUsdc6: registryState.price, contentCid: "", tags: "", active: true } });
      } else throw new Error("Unsupported fixture RPC");
      response.writeHead(200, { "Content-Type": "application/json", "Connection": "close" }); response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
    } catch { rpcFailures.push("Synthetic registry RPC assertion failed"); response.writeHead(500, { "Connection": "close" }); response.end(); }
  });
  sourceRpc.listen(0, "127.0.0.1"); await once(sourceRpc, "listening"); const address = sourceRpc.address(); assert(address && typeof address !== "string");
  const authority = createSyntheticBrowserOriginalSourceAuthority(catalog, `http://127.0.0.1:${address.port}`, registry);
  const sources = await Promise.all([admitSupabaseBrowserSourceSigningOriginal(sb, publicInput, authority), admitSupabaseBrowserSourceSigningOriginal(sb, publicInput, authority)]);
  assert(sources.every(answer => answer.status === "admitted")); assert(sources[0].status === "admitted" && sources[1].status === "admitted"); assert.deepEqual(sources[0].original, sources[1].original);
  assert.equal(sources[0].original.protocol, "durable-v3"); assert.equal(sql(`select spent_micro from public.browser_signing_queries where query_id='${sourcePolicy.queryId}'`), "3");
  const sourceSaved = sources[0];
  sql("update public.browser_journal_control set active=false where id=1");
  await unchanged(async () => { assert.throws(() => service(`select public.transition_browser_journal('synthetic-owner','${sourceSaved.journal.requestId}','prepared','exposed')`), /inactive/); });
  sql("update public.browser_journal_control set active=true where id=1");
  service(`select public.transition_browser_journal('synthetic-owner','${sourceSaved.journal.requestId}','prepared','exposed')`);
  const sourceHeader = serializeBrowserSigningHeader(sourceSaved.original, await signer.signTypedData(browserSigningTypedData(sourceSaved.original)));
  assert.equal(await signSupabaseBrowserSigningOriginal(sb, "synthetic-owner", sourceSaved.journal.requestId, sourceHeader), true);
  assert((counts.get("eth_call") ?? 0) >= 1 && (counts.get("eth_getBlockByNumber") ?? 0) >= 2 && (counts.get("eth_chainId") ?? 0) >= 6); assert.deepEqual(rpcFailures, []);
  const noAuthority = { async resolve(): Promise<never> { throw new Error("Historical replay must not contact current authority"); } };
  service("select public.disable_browser_journal_grant('synthetic-owner')");
  await unchanged(async () => { const replay = await admitSupabaseBrowserSourceSigningOriginal(sb, publicInput, noAuthority); assert(replay.status === "admitted"); assert.deepEqual(replay.original, sourceSaved.original); });
  await unchanged(async () => { assert.equal((await admitSupabaseBrowserSourceSigningOriginal(sb, { ...publicInput, source: { ...publicInput.source, contentVersion: "foreign" } }, noAuthority)).status, "refused"); });
  await unchanged(async () => { await assert.rejects(() => admitSupabaseBrowserSourceSigningOriginal(sb, { ...publicInput, journal: { ...publicInput.journal, kind: "citation" } }, noAuthority)); });
  await unchanged(async () => { assert.throws(() => sql(`update public.browser_signing_originals set original=jsonb_set(original,'{sourceContext,registry,payoutWallet}','"${owner.address.toLowerCase()}"') where nonce='${sourceSaved.journal.nonce}'`), /immutable/); });
  grant(sourceEpoch);
  const nextSource = { ...publicInput, journal: { ...publicInput.journal, requestId: randomUUID() } }, token = await authority.resolve(nextSource), nextPrepared = prepareBrowserSourceSigningAdmission(nextSource, token);
  await unchanged(async () => { const result = await sb.rpc("browser_signing_admit_source_original", { p_input: nextPrepared.input, p_journal: nextPrepared.journal, p_original: { ...nextPrepared.original, sourceContextDigest: digest() } }); assert(result.error); });
  sql(`create function public.synthetic_source_failure() returns trigger language plpgsql as $$begin raise exception 'synthetic source rollback'; end$$;create trigger synthetic_source_failure before insert on public.browser_signing_originals for each row execute function public.synthetic_source_failure()`);
  await unchanged(async () => { await assert.rejects(() => admitSupabaseBrowserSourceSigningOriginal(sb, nextSource, authority)); });
  sql("drop trigger synthetic_source_failure on public.browser_signing_originals;drop function public.synthetic_source_failure()");
  const offerEpoch = randomUUID(); grant(offerEpoch, 0.001);
  const offerPolicy = { ...sourcePolicy, policyId: digest(), requestNonce: digest(), queryId: randomUUID(), grantEpoch: offerEpoch, queryCeilingMicros: "250", lifetimeCeilingMicros: "500", jobLimit: 4 };
  assert.equal((await admitSupabaseBrowserQueryPolicy(sb, { policy: offerPolicy, signature: await owner.signTypedData(browserQueryPolicyTypedData(offerPolicy)) }, "synthetic-owner")).status, "admitted");
  registryState.height = 2n; registryState.hash = digest(); registryState.price = 1000n;
  const offerTerms = { sourceId: "synthetic-source", itemId: sourceItem.id, contentVersion: publicInput.source.contentVersion, priceUsdc6: 100, expiresAt: Math.floor(Date.now() / 1000) + 600, nonce: digest() };
  const offerSignature = await owner.signTypedData(articleOfferTypedData(offerTerms)), offerId = articleOfferId(offerSignature);
  sql(`insert into public.article_offers(source_id,item_id,id,content_version,price_usdc6,expires_at,signer,nonce,signature) values('synthetic-source','${sourceItem.id}','${offerId}','${offerTerms.contentVersion}',100,${offerTerms.expiresAt},'${owner.address.toLowerCase()}','${offerTerms.nonce}','${offerSignature}')`);
  const offerInput: BrowserSourceOriginalAdmission = { ...makeInput(verified.namespace, offerPolicy.queryId, offerEpoch), protocol: "durable-v3", source: { ...publicInput.source, offerId } };
  offerInput.journal.offerId = offerId; offerInput.journal.amountMicroUsdc = 100; offerInput.journal.requirements.amount = "100";
  Object.assign(offerInput.journal.payment, { itemId: sourceItem.id, contentVersion: publicInput.source.contentVersion, offerId, amountUsdc: 0.0001 });
  const creatorOffer = await admitSupabaseBrowserSourceSigningOriginal(sb, offerInput, authority); assert(creatorOffer.status === "admitted" && creatorOffer.original.protocol === "durable-v3");
  assert.equal(creatorOffer.original.sourceContext.price.mode, "creator-offer");
  if (creatorOffer.original.sourceContext.price.mode !== "creator-offer") throw new Error("Synthetic creator offer context missing");
  assert.equal(creatorOffer.original.sourceContext.price.offer.signature, offerSignature);
  assert.deepEqual(creatorOffer.original.sourceContext.price.offer, await catalog.getArticleOffer("synthetic-source", sourceItem.id));
  await unchanged(async () => { const coherent = await readSupabaseBrowserSigningSnapshot(sb, policy.owner, "synthetic-owner", offerInput.journal.requestId); assert.deepEqual(coherent?.original, creatorOffer.original); });
  service(`select public.transition_browser_journal('synthetic-owner','${offerInput.journal.requestId}','prepared','exposed')`);
  const offerHeader = serializeBrowserSigningHeader(creatorOffer.original, await signer.signTypedData(browserSigningTypedData(creatorOffer.original)));
  assert.equal(await signSupabaseBrowserSigningOriginal(sb, "synthetic-owner", offerInput.journal.requestId, offerHeader), true);
  const wrongSignature = await signer.signTypedData(articleOfferTypedData(offerTerms)), wrongId = articleOfferId(wrongSignature);
  sql(`update public.article_offers set id='${wrongId}',signature='${wrongSignature}' where source_id='synthetic-source'`);
  const wrongInput = { ...offerInput, source: { ...offerInput.source, offerId: wrongId }, journal: { ...offerInput.journal, requestId: randomUUID(), offerId: wrongId, payment: { ...offerInput.journal.payment, offerId: wrongId } } };
  await unchanged(async () => { await assert.rejects(() => admitSupabaseBrowserSourceSigningOriginal(sb, wrongInput, authority)); });
  sql(`update public.article_offers set id='${offerId}',signature='${offerSignature}' where source_id='synthetic-source'`);
  const tamperInput = { ...offerInput, journal: { ...offerInput.journal, requestId: randomUUID() } }, offerToken = await authority.resolve(tamperInput), offerPrepared = prepareBrowserSourceSigningAdmission(tamperInput, offerToken);
  const tamperedContext = { ...offerPrepared.original.sourceContext, registry: { ...offerPrepared.original.sourceContext.registry, payoutWallet: owner.address.toLowerCase() } };
  const tamperedOriginal = prepareBrowserSourceSigningOriginal(offerPrepared.journal, verified.namespace, tamperedContext);
  await unchanged(async () => { const result = await sb.rpc("browser_signing_admit_source_original", { p_input: { ...offerPrepared.input, sourceContext: tamperedContext }, p_journal: offerPrepared.journal, p_original: tamperedOriginal }); assert(result.error); });
  const expiringTerms = { ...offerTerms, nonce: digest(), expiresAt: Math.floor(Date.now() / 1000) + 4 }, expiringSignature = await owner.signTypedData(articleOfferTypedData(expiringTerms)), expiringId = articleOfferId(expiringSignature);
  sql(`update public.article_offers set id='${expiringId}',nonce='${expiringTerms.nonce}',signature='${expiringSignature}',expires_at=${expiringTerms.expiresAt} where source_id='synthetic-source'`);
  const expiringInput = { ...offerInput, source: { ...offerInput.source, offerId: expiringId }, journal: { ...offerInput.journal, requestId: randomUUID(), offerId: expiringId, payment: { ...offerInput.journal.payment, offerId: expiringId } } };
  const expiringToken = await authority.resolve(expiringInput), expiringPrepared = prepareBrowserSourceSigningAdmission(expiringInput, expiringToken);
  const capacityLock = await transaction(`begin;select signer from public.browser_signer_capacity where signer='${signer.address.toLowerCase()}' for update`);
  await unchanged(async () => {
    assertVerifiedBrowserOriginalSourceContextCurrent(expiringToken, expiringInput);
    const pending = sb.rpc("browser_signing_admit_source_original", { p_input: expiringPrepared.input, p_journal: expiringPrepared.journal, p_original: expiringPrepared.original }).then(value => value);
    const waitDeadline = performance.now() + 2000; let blocked = false;
    while (performance.now() < waitDeadline) {
      if (sql("select exists(select 1 from pg_stat_activity where datname='postgres' and wait_event_type='Lock' and query like '%browser_signing_admit_source_original%')") === "t") { blocked = true; break; }
      await new Promise(r => setTimeout(r, 20));
    }
    assert(blocked, "actual source operation must reach the held capacity lock before expiry");
    const expiryDeadline = performance.now() + 6000;
    while (Number(sql("select floor(extract(epoch from clock_timestamp()))")) < expiringTerms.expiresAt && performance.now() < expiryDeadline) await new Promise(r => setTimeout(r, 100));
    assert(Number(sql("select floor(extract(epoch from clock_timestamp()))")) >= expiringTerms.expiresAt);
    await capacityLock.close(); const answer = await pending;
    assert(answer.error && answer.error.message === "browser source offer refused", "fresh offer expiry after capacity lock must atomically refuse");
  });
  sql(`update public.article_offers set id='${offerId}',nonce='${offerTerms.nonce}',signature='${offerSignature}',expires_at=${offerTerms.expiresAt} where source_id='synthetic-source'`);
  console.log("PASS actual capacity-lock wait reaches offer expiry; journal/original/query/signer reservations all roll back");
  console.log("PASS actual creator EIP712 offer/PG exact context+digest coherent roundtrip/canonical callback/wrong creator proof+bound-context refusal");
  // A second database exists only inside this UUID-owned ephemeral container.
  // Its first activation goes directly from an empty floor2 barrier to floor3.
  const emptyFloorDatabase = "browser_original_empty_floor";
  sql(`create database ${emptyFloorDatabase}`);
  sql("create publication supabase_realtime;" + migrations.map(f => readFileSync(`supabase/migrations/${f}`, "utf8")).join("\n"), emptyFloorDatabase);
  assert.equal(sql("select count(*) from public.browser_signing_v2_barrier", emptyFloorDatabase), "0");
  const initialEpoch = randomUUID(), initialInput = makeInput(verified.namespace, randomUUID(), initialEpoch, "empty-floor-prepared"), initialJournal = prepareBrowserJournal(initialInput.journal), initialA = initialInput.journal;
  sql(`set role service_role;select public.activate_browser_journal();select public.upsert_browser_journal_grant(${json({ session_id: "synthetic-owner", owner_addr: owner.address.toLowerCase(), sess_addr: signer.address.toLowerCase(), cap: 0.000010, expiry: Date.now() + 3600000, tx_hash: "synthetic-unfunded", grant_epoch: initialEpoch })});
    select public.admit_browser_journal(${json({ ...legacyIntent, nonce: initialJournal.nonce, request_id: initialA.requestId, query_id: initialA.queryId, grant_epoch: initialEpoch, created_at: initialJournal.admittedAt })},${json(initialJournal.requirements)},${json(initialJournal.payment)})`, emptyFloorDatabase);
  const emptyFresh = await transaction("begin isolation level repeatable read;select min_original_version from public.browser_signing_v2_control;select count(*) from public.browser_signing_v2_barrier;set role service_role", emptyFloorDatabase);
  const emptyExposure = await transaction("begin isolation level repeatable read;select min_original_version from public.browser_signing_v2_control;select count(*) from public.browser_signing_v2_barrier;set role service_role", emptyFloorDatabase);
  sql("update public.browser_signing_v2_control set active=true,min_original_version=3 where id=1", emptyFloorDatabase);
  assert.equal(sql("select min_original_version from public.browser_signing_v2_barrier", emptyFloorDatabase), "3");
  const emptyBefore = snapshot(emptyFloorDatabase), anotherInput = makeInput(verified.namespace, initialA.queryId, initialEpoch, "empty-floor-fresh"), anotherJournal = prepareBrowserJournal(anotherInput.journal);
  const anotherIntent = { ...legacyIntent, nonce: anotherJournal.nonce, request_id: anotherInput.journal.requestId, query_id: initialA.queryId, grant_epoch: initialEpoch, created_at: anotherJournal.admittedAt };
  await assert.rejects(() => emptyFresh.command(`select public.admit_browser_journal(${json(anotherIntent)},${json(anotherJournal.requirements)},${json(anotherJournal.payment)})`), /SQLSTATE40001/);
  await assert.rejects(() => emptyExposure.command("select public.transition_browser_journal('synthetic-owner','empty-floor-prepared','prepared','exposed')"), /SQLSTATE40001/);
  await emptyFresh.close(); await emptyExposure.close();
  assert.equal(snapshot(emptyFloorDatabase), emptyBefore);
  for (const writer of ["browser_journal_writer", "browser_signing_v2_writer", "browser_signing_v3_writer"]) assert.equal(sql(`select count(*) from public.${writer}`, emptyFloorDatabase), "0");
  sql(`drop database ${emptyFloorDatabase}`);
  assert.equal(sql(`select count(*) from pg_database where datname='${emptyFloorDatabase}'`), "0");
  console.log("PASS direct first-floor3 activation from EMPTY barrier refuses valid stale-RR fresh writer+prepared exposure with SQLSTATE40001; full state unchanged; owned database removed");
  assert.deepEqual(rpcFailures, []);
  console.log("PASS actual native registry observation/v3 immutable context+digest/raced atomic admission/keyless exact history/citation refusal/source rollback");
  for (const role of ["anon", "authenticated"] as const) for (const rpc of [`select public.browser_signing_admit_query(${json(verified)},'synthetic-owner')`, `select public.browser_signing_admit_original('{}','{}','{}')`,
    `select public.browser_signing_record_signature('synthetic-owner','${input.journal.requestId}','{}')`, `select public.browser_signing_header_original('synthetic-owner','${input.journal.requestId}')`, `select public.browser_signing_snapshot('${policy.owner}','synthetic-owner','${input.journal.requestId}')`,
    `select public.browser_signing_exposed_snapshot_for_signer('${signer.address}','synthetic-owner','${input.journal.requestId}')`]) {
    await unchanged(async () => { assert.throws(() => sql(`set role ${role};${rpc}`), /permission denied/); });
  }
  for (const role of ["anon", "authenticated"] as const) for (const rpc of ["select public.browser_signing_replay_source_original('{}')", "select public.browser_signing_admit_source_original('{}','{}','{}')"]) await unchanged(async () => { assert.throws(() => sql(`set role ${role};${rpc}`), /permission denied/); });
  for (const privateCall of ["select public.browser_signing_original_floor_for_write()", "select public.browser_signing_v2_admission_internal('{}','{}','{}')", "select public.browser_signing_source_context_check('{}','{}','{}')"]) await unchanged(async () => { assert.throws(() => service(privateCall), /permission denied/); });
  for (const table of ["browser_signing_v2_control", "browser_signing_v2_writer", "browser_signing_v3_writer", "browser_signing_v2_barrier", "browser_signing_namespaces", "browser_signing_policies", "browser_signing_queries", "browser_signing_originals"]) {
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
  let ancillaryFailures = 0;
  for (const child of sqlSessions) if (child.exitCode === null) { try {
    child.stdin!.end("rollback;\n"); let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([once(child, "exit"), new Promise<void>(resolve => { timer = setTimeout(() => { if (child.exitCode === null) { child.kill(); ancillaryFailures++; } resolve(); }, 2000); })]); }
    finally { if (timer) clearTimeout(timer); }
  } catch { ancillaryFailures++; }
  }
  if (sourceRpc) { try { sourceRpc.closeAllConnections(); await new Promise<void>((resolve, reject) => sourceRpc!.close(error => error ? reject(new Error("Synthetic RPC cleanup refused")) : resolve())); } catch { ancillaryFailures++; } }
  if (engine) {
    let failures = 0; const existing = docker(["ps", "-a", "--format", "{{.Names}}"]).trim().split("\n");
    for (const container of created.reverse()) if (existing.includes(container)) { try { docker(["rm", "-f", "-v", container]); } catch { failures++; } }
    assert.deepEqual(docker(["ps", "-a", "--format", "{{.Names}}"]).trim().split("\n").filter(n => owned.includes(n)), []); assert.equal(failures, 0);
  }
  assert.equal(ancillaryFailures, 0, "Owned synthetic RPC/SQL process cleanup failed");
}
console.log("PASS actual role ACL/direct-write refusal/DB+HTTP restart coherent readback/owned cleanup; synthetic only");
