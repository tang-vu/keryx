/** TEST ONLY. Actual isolated PostgreSQL/PostgREST, generated memory keys and
 * localhost protocol evidence. No runtime activation, keys or external funding. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { canonicalJson } from "../lib/canonical-json";
import { syntheticStorageIdentity } from "../lib/db/storage-identity-fixture";
import { validateGatewayFundingOperation } from "../lib/payments/gateway-funding-policy";
import { GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST } from "../lib/payments/gateway-funding-receipt-policy";
import type { FundingOwnerInstallation, GatewayFundingLedger } from "../lib/db/gateway-funding-ledger-types";
import { postgresFundingProtocol, type ReceiptMode } from "./gateway-funding-postgres-orchestration-protocol-fixture.mts";

// Native .mts and .ts can have separate tsx module identities on Node24.10.
// Load issuer consumers and protected store from ONE private CJS graph.
const require = createRequire(import.meta.url);
const { SupabaseAuthority } = require("../lib/db/supabase-authority.ts") as typeof import("../lib/db/supabase-authority");
const { SupabaseGatewayFundingLedger } = require("../lib/db/gateway-funding-supabase.ts") as typeof import("../lib/db/gateway-funding-supabase");
const { SupabaseGatewayFundingTerminalObserverStore } = require("../lib/db/gateway-funding-supabase-observer.ts") as typeof import("../lib/db/gateway-funding-supabase-observer");
const { createGatewayFundingOrchestratorForTrustedSyntheticComposition: execute, createKeylessGatewayFundingOrchestratorForTrustedSyntheticComposition: recover } =
  require("../lib/payments/gateway-funding-orchestrator.ts") as typeof import("../lib/payments/gateway-funding-orchestrator");
const { createGatewayFundingExecutorForTrustedSyntheticComposition } = require("../lib/payments/gateway-funding-executor.ts") as typeof import("../lib/payments/gateway-funding-executor");
const steps = ["nativeTransfer", "usdcTransfer", "approval", "deposit"] as const;
const composition = (p: Awaited<ReturnType<typeof postgresFundingProtocol>>) => ({ origins: p.origins, circleEndpoint: p.circleEndpoint });
const name = `keryx-orchestration-pg-${randomUUID()}`, names = [name, `${name}-http`, `${name}-observer`, `${name}-curl`];
const started: string[] = [];
let engineAvailable = false;
const docker = (args: string[], input?: string) => execFileSync("docker", args, { input, encoding: "utf8", timeout: 60000, stdio: ["pipe", "pipe", "pipe"] });
const sql = (statement: string) => docker(["exec", "-i", name, "psql", "-h", "127.0.0.1", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"],
  `set statement_timeout='30s'; set lock_timeout='5s'; ${statement}`).trim();
const json = (v: unknown) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`;
const identity = syntheticStorageIdentity("testnet-real");
function start(container: string, image: string, args: string[]) {
  started.push(container); docker(["run", "-d", "--name", container, ...args, image]);
}
// Persistent curl helper avoids per-RPC container creation consuming token TTL.
// No host ports or mounts. PostgREST remains inside the PG network-none namespace.
const httpFetch = (port: number): typeof fetch => async (input, init) => {
  const path = new URL(String(input)).pathname.replace(/^\/rest\/v1/, "");
  assert(/^\/rpc\/(read_storage_identity|storage_funding_[a-z_]+)$/.test(path));
  const args = ["exec", "-i", names[3], "curl", "--max-time", "10", "--silent", "--show-error", "--request", "POST", "--header", "Content-Type: application/json",
    "--data-binary", "@-", "--write-out", "\n%{http_code}", `http://127.0.0.1:${port}${path}`];
  const output = await new Promise<string>((resolve, reject) => {
    const child = execFile("docker", args, { encoding: "utf8", timeout: 15000 }, (error, out) => error ? reject(new Error("Synthetic PostgREST transport unavailable")) : resolve(out));
    child.stdin!.end(String(init?.body ?? "{}"));
  });
  const split = output.lastIndexOf("\n"), status = Number(output.slice(split + 1));
  return new Response(status === 204 ? null : output.slice(0, split), { status, headers: { "Content-Type": "application/json" } });
};
try {
  try { docker(["info", "--format", "{{.ServerVersion}}"]); engineAvailable = true; } catch { throw new Error("Actual isolated PostgreSQL acceptance requires Docker; gate did not run"); }
  start(name, "postgres:17", ["--network", "none", "--memory", "512m", "--cpus", "1", "-e", "POSTGRES_HOST_AUTH_METHOD=trust"]);
  let ready = false;
  const startupEnd = performance.now() + 10000;
  while (performance.now() < startupEnd) { try {
    execFileSync("docker", ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"], { timeout: 2000, stdio: "ignore" }); ready = true; break;
  } catch { await new Promise(r => setTimeout(r, 100)); } }
  assert(ready, "bounded PG startup");
  const historical = readdirSync("supabase/migrations").filter(f => /^\d{4}.*\.sql$/.test(f) && Number(f.slice(0, 4)) < 70).sort();
  const candidates = readdirSync("scripts/test-fixtures/funding-postgres").filter(f => /^007[0-5].*\.sql$/.test(f)).sort(); assert.equal(candidates.length, 6);
  const paths = [...historical.map(f => `supabase/migrations/${f}`), ...candidates.map(f => `scripts/test-fixtures/funding-postgres/${f}`)];
  sql("create role anon;create role authenticated;create role service_role bypassrls;create publication supabase_realtime;" + paths.map(f => readFileSync(f, "utf8")).join("\n"));
  sql(`select keryx_storage.enroll(${json(identity)},'${sql("select keryx_storage.snapshot_digest()") }')`);
  const bindingDigest = sql("select keryx_storage.funding_backend_binding()"); assert.match(bindingDigest, /^[a-f0-9]{64}$/);
  sql(`create role orchestration_http login;alter role orchestration_http set statement_timeout='10s';grant service_role to orchestration_http;
    create role orchestration_observer_http login;alter role orchestration_observer_http set statement_timeout='10s';grant keryx_gateway_funding_observer to orchestration_observer_http`);
  for (const [index, role, login, port] of [[1, "service_role", "orchestration_http", 3000], [2, "keryx_gateway_funding_observer", "orchestration_observer_http", 3001]] as const) {
    start(names[index], "postgrest/postgrest:v12.2.3", ["--network", `container:${name}`, "--memory", "256m", "--cpus", "0.5", "-e", `PGRST_DB_URI=postgres://${login}@127.0.0.1:5432/postgres`,
      "-e", `PGRST_DB_ANON_ROLE=${role}`, "-e", "PGRST_DB_SCHEMAS=public", "-e", "PGRST_DB_CONFIG=false", "-e", "PGRST_DB_POOL=2", "-e", `PGRST_SERVER_PORT=${port}`]);
  }
  started.push(names[3]); docker(["run", "-d", "--name", names[3], "--network", `container:${name}`, "--memory", "64m", "--entrypoint", "sh", "curlimages/curl:8.12.1", "-c", "sleep 900"]);
  const makeAuthority = (port: number) => new SupabaseAuthority(createClient("http://synthetic.invalid", "synthetic-no-authority", { auth: { persistSession: false }, global: { fetch: httpFetch(port) } }), identity);
  const actor = makeAuthority(3000), observer = makeAuthority(3001);
  for (const authority of [actor, observer]) {
    let initialized = false; for (let i = 0; i < 20; i++) { try { await authority.init(); initialized = true; break; } catch { await new Promise(r => setTimeout(r, 200)); } } assert(initialized);
  }
  const ledger = new SupabaseGatewayFundingLedger(actor), terminalStore = new SupabaseGatewayFundingTerminalObserverStore(ledger, observer);
  const fixture = async (mode: ReceiptMode) => {
    const funderPrivateKey = generatePrivateKey(), spendPrivateKey = generatePrivateKey();
    const operation = validateGatewayFundingOperation({ format: "gateway-funding-operation-v1", policy: {
      format: "gateway-funding-policy-v1", identity, policyId: randomUUID(), funder: privateKeyToAccount(funderPrivateKey).address.toLowerCase(), spend: privateKeyToAccount(spendPrivateKey).address.toLowerCase(),
      lifetimeLimits: { nativeWei: "50", usdcMicros: "100", depositMicros: "100", gasWei: "2610000" }, maxTransactionGas: "120000", maxFeePerGasWei: "10" },
      operationId: randomUUID(), ownerAuthorizationId: randomUUID(), ownerAuthorizationDigest: "b".repeat(64), minimumAvailableMicros: "100", initialAvailableMicros: "0", nativeTransferWei: "50", usdcTransferMicros: "100", approvalMicros: "100", depositMicros: "100",
      gasLimits: { nativeTransfer: "21000", usdcTransfer: "60000", approval: "60000", deposit: "120000" }, maxFeePerGasWei: "10", maxPriorityFeePerGasWei: "1" });
    const installation: FundingOwnerInstallation = { format: "gateway-funding-owner-installation-v1", policy: operation.policy,
      funderGasBudgetWei: "810000", spendGasBudgetWei: "1800000", reviewedSnapshotDigest: sql("select keryx_storage.snapshot_digest()"), reviewedTargetDigest: bindingDigest,
      finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST, history: { format: "gateway-funding-empty-isolated-history-v1", documentDigest: "c".repeat(64), funderInitialNonce: "0", spendInitialNonce: "0" } };
    sql(`select keryx_storage.install_funding_policy(${json(identity)},${json(installation)});select keryx_storage.install_funding_authorization(${json(identity)},${json(operation)})`);
    const keyless = { ledger, terminalStore, expectedIdentity: identity, expectedBackendBindingDigest: bindingDigest,
      installedPolicyDigest: createHash("sha256").update(canonicalJson(operation.policy)).digest("hex"), finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST, assertCurrentAuthority: () => { ledger.getStorageIdentity(); } };
    const protocol = await postgresFundingProtocol(ledger, operation, mode), options = { ...keyless, funderPrivateKey, spendPrivateKey };
    const snapshot = async () => ({ full: sql("select keryx_storage.snapshot_digest()"), operation: await ledger.inspectOperation(operation.operationId),
      namespaces: await Promise.all([operation.policy.funder, operation.policy.spend].map(s => ledger.inspectNamespace(s))),
      originals: await Promise.all(steps.map(s => ledger.inspectReservation(operation.operationId, s))) });
    const unchanged = async (fn: () => Promise<void>) => { const before = await snapshot(); await fn(); assert.deepEqual(await snapshot(), before); assert.equal(sql("select count(*) from keryx_storage.writer"), "0"); };
    return { operation, protocol, options, keyless, snapshot, unchanged };
  };
  let forbiddenMutations = 0;
  const readOnly = (target: GatewayFundingLedger) => {
    const allowed = new Set(["getStorageIdentity", "inspectOperation", "inspectNamespace", "inspectReservation"]);
    return new Proxy(target, { get(t, p) { const value = Reflect.get(t, p, t); return typeof value !== "function" ? value : allowed.has(String(p)) ? value.bind(t) : () => { forbiddenMutations++; throw new Error("Keyless attempted ledger mutation"); }; } });
  };
  const success = await fixture("success");
  try {
    const fresh = execute(success.options, composition(success.protocol));
    const first = fresh.runOperation(success.operation.operationId), concurrent = fresh.runOperation(success.operation.operationId);
    assert.equal(first, concurrent, "same live attempt coalesces without a second authority claim");
    const answer = await first; assert.equal((await concurrent).status, answer.status);
    assert.equal(answer.status, "current-funding-ready"); assert.equal(answer.readiness?.availableMicros, "100"); assert.equal(success.protocol.sends.length, 4);
    const saved = await success.snapshot();
    saved.originals.forEach((s, i) => { assert(s?.prepared && s.cryptoClaimId && s.broadcastClaimId && s.terminal); assert.equal(s.state, "finalized-success");
      assert.equal(s.transaction.nonce, String(i % 2)); assert.equal(s.terminal.transactionHash, success.protocol.sends[i].hash); assert.equal(s.terminal.nonce, s.transaction.nonce); });
    for (const n of saved.namespaces) { assert.equal(n.nextCryptoNonce, "2"); assert.equal(n.nextNonce, "2"); }
    assert.deepEqual(saved.namespaces[0].used, { nativeWei: "50", usdcMicros: "100", depositMicros: "0", gasWei: "810000" });
    assert.deepEqual(saved.namespaces[1].used, { nativeWei: "0", usdcMicros: "0", depositMicros: "100", gasWei: "1800000" });
    await success.unchanged(async () => { const result = await recover({ ...success.keyless, ledger: readOnly(ledger) }, composition(success.protocol)).runOperation(success.operation.operationId); assert.equal(result.status, "current-funding-ready"); });
    await success.unchanged(async () => { const result = await execute({ ...success.options, funderPrivateKey: "invalid" as `0x${string}`, spendPrivateKey: "invalid" as `0x${string}` }, composition(success.protocol)).runOperation(success.operation.operationId); assert.equal(result.status, "current-funding-ready"); });
    assert.equal(success.protocol.sends.length, 4); assert.equal(forbiddenMutations, 0); console.log("PASS actual four protected originals/barriers/caps and keyless completed restart");
  } finally { await success.protocol.close(); }
  const partial = await fixture("success");
  try {
    await ledger.admitOperation(partial.operation.operationId); await ledger.reserveStep(partial.operation.operationId, "nativeTransfer", "0");
    await partial.unchanged(async () => { const r = await execute({ ...partial.options, funderPrivateKey: "invalid" as `0x${string}`, spendPrivateKey: "invalid" as `0x${string}` }, composition(partial.protocol)).runOperation(partial.operation.operationId); assert.equal(r.status, "reconciliation-required"); });
    assert.equal(partial.protocol.calls.length, 0); assert.equal(partial.protocol.sends.length, 0); console.log("PASS any saved slot suppresses new signing/send/remaining legs");
  } finally { await partial.protocol.close(); }
  for (const mode of ["missing", "disagreement", "reverted"] as const) {
    const f = await fixture(mode);
    try {
      await ledger.admitOperation(f.operation.operationId);
      const { terminalStore: _terminal, ...executorOptions } = f.options;
      assert.equal((await createGatewayFundingExecutorForTrustedSyntheticComposition(executorOptions, f.protocol.origins).executeStep(f.operation.operationId, "nativeTransfer")).status, "broadcast-acknowledged");
      const original = await ledger.inspectReservation(f.operation.operationId, "nativeTransfer"); assert(original?.prepared && original.broadcastClaimId);
      const result = await recover({ ...f.keyless, ledger: readOnly(ledger) }, composition(f.protocol)).runOperation(f.operation.operationId);
      assert.equal(result.status, mode === "reverted" ? "execution-reverted" : "reconciliation-required");
      assert(f.protocol.calls.some(c => c.method === "eth_getTransactionReceipt" && c.provider === 0));
      if (mode === "disagreement") assert(f.protocol.calls.some(c => c.method === "eth_getTransactionReceipt" && c.provider === 1));
      const after = await f.snapshot(); assert.equal(after.originals[0]?.prepared?.transactionHash, original.prepared.transactionHash);
      assert(after.originals.slice(1).every(s => s === null));
      // Admission conservatively reserves the whole immutable movement/gas plan;
      // an unknown or reverted first original never refunds unused later legs.
      assert.deepEqual(after.namespaces[0].used, { nativeWei: "50", usdcMicros: "100", depositMicros: "0", gasWei: "810000" });
      assert.deepEqual(after.namespaces[1].used, { nativeWei: "0", usdcMicros: "0", depositMicros: "100", gasWei: "1800000" });
      assert.equal(after.namespaces[0].nextCryptoNonce, mode === "reverted" ? "1" : "0");
      if (mode === "reverted") { assert.equal(after.originals[0]?.terminal?.receiptStatus, "reverted"); assert.equal(after.originals[0]?.terminal?.transactionHash, original.prepared.transactionHash); }
      await f.unchanged(async () => { const r = await recover({ ...f.keyless, ledger: readOnly(ledger) }, composition(f.protocol)).runOperation(f.operation.operationId); assert.equal(r.status, result.status); });
      assert.equal(forbiddenMutations, 0);
      assert.equal(f.protocol.sends.length, 1); assert(!f.protocol.calls.some(c => c.method === "circle-balances")); console.log(`PASS ${mode} original keyless no replacement/refund`);
    } finally { await f.protocol.close(); }
  }
  const roles = await fixture("success");
  try { for (const role of ["anon", "authenticated"] as const) await roles.unchanged(async () => {
    let entered = 0;
    const restricted = new Proxy(ledger, { get(t, p) { if (p === "inspectOperation") return async () => { entered++; assert.throws(() => sql(`set role ${role};select public.storage_funding_inspect_operation(${json(identity)},'${roles.operation.operationId}')`), /permission denied/); throw new Error("Actual normal-role PG ACL refused"); }; const v = Reflect.get(t, p, t); return typeof v === "function" ? v.bind(t) : v; } });
    const result = await recover({ ...roles.keyless, ledger: restricted }, composition(roles.protocol)).runOperation(roles.operation.operationId);
    assert.equal(result.status, "reconciliation-required"); assert.equal(entered, 1); assert.equal(roles.protocol.calls.length, 0);
  }); console.log("PASS normal-role actual SQL ACL via readonly forwarding refuses before protocol"); } finally { await roles.protocol.close(); }
  terminalStore.close(); console.log("Actual isolated PG17/PostgREST controlled four-leg acceptance passed; synthetic provider evidence only");
} finally {
  if (engineAvailable) {
    let cleanupFailures = 0;
    const existing = docker(["ps", "-a", "--format", "{{.Names}}"]).trim().split("\n");
    for (const container of started.reverse()) if (existing.includes(container)) { try { docker(["rm", "-f", "-v", container]); } catch { cleanupFailures++; } }
    const remaining = docker(["ps", "-a", "--format", "{{.Names}}"]).trim().split("\n").filter(container => names.includes(container));
    assert.deepEqual(remaining, [], "all owned isolated containers removed"); assert.equal(cleanupFailures, 0, "isolated cleanup failed");
  }
}
