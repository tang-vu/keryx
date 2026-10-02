import { normalizeFundingSnapshotMigration } from "./helpers/postgres-snapshot-diagnostics.mts";
import assert from "node:assert/strict";
import { testPostgresFundingReadiness } from "./gateway-funding-postgres-readiness-fixture.mts";
import { createRequire } from "node:module";
import { execFile, execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { keccak256, parseTransaction } from "viem";
import { SupabaseAuthority } from "../lib/db/supabase-authority";
import { SupabaseGatewayFundingLedger } from "../lib/db/gateway-funding-supabase";
import { SupabaseGatewayFundingTerminalObserverStore } from "../lib/db/gateway-funding-supabase-observer";
// Node24.10 splits native .mts ESM and .ts CJS instances under tsx. Mint in
// the adapter's CJS issuer instance so its private WeakMap remains authoritative.
const { createGatewayFundingReceiptObserverForTrustedComposition, unsealVerifiedGatewayFundingReceipt } =
  createRequire(import.meta.url)("../lib/payments/gateway-funding-receipt-observer.ts") as typeof import("../lib/payments/gateway-funding-receipt-observer");
import { GATEWAY_FUNDING_RECEIPT_POLICY, GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST } from "../lib/payments/gateway-funding-receipt-policy";
import { syntheticStorageIdentity } from "../lib/db/storage-identity-fixture";
import { prepareGatewayFundingTransaction } from "../lib/payments/gateway-funding-transaction";
import { gatewayFundingReplayDigest, validateGatewayFundingOperation } from "../lib/payments/gateway-funding-policy";
import type { SignedGatewayFundingTransaction } from "../lib/payments/gateway-funding-transaction";
import type { FundingOwnerInstallation, FundingTerminalEvidence } from "../lib/db/gateway-funding-ledger-types";

// Synthetic isolated PG17+PostgREST only: no inherited project configuration,
// published ports, mounts, paid RPC, real keys or network sends. Engine absence
// fails the gate. Each command and owner statement has an external deadline.
const name = `keryx-funding-pg-${Date.now()}`;
const httpName = `${name}-http`;
const observerHttpName = `${name}-observer-http`;
const binary = process.platform === "win32" ? "wsl.exe" : "docker";
const prefix = process.platform === "win32" ? ["-d", "Ubuntu", "--", "docker"] : [];
const docker = (args: string[], input?: string) => execFileSync(binary, [...prefix, ...args], { input, encoding: "utf8", timeout: 60_000, stdio: ["pipe", "pipe", "pipe"] });
const psql = ["exec", "-i", name, "psql", "-h", "127.0.0.1", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"];
const sql = (statement: string) => docker(psql, `set statement_timeout='30s'; set lock_timeout='5s'; ${statement}`).trim();
const sqlIn = (database: string, statement: string) => docker([...psql, "-d", database], `set statement_timeout='30s'; set lock_timeout='5s'; ${statement}`).trim();
const service = (statement: string) => sql(`set role service_role; ${statement}`);
const json = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const identity = syntheticStorageIdentity("testnet-real"), expected = json(identity);
const rpc = (method: string, ...args: string[]) => `select public.storage_funding_${method}(${[expected, ...args].join(",")})`;
const concurrent = (statement: string, role: "service_role" | "synthetic_observer" = "service_role") => new Promise<string>((resolve, reject) => {
  const child = execFile(binary, [...prefix, ...psql], { encoding: "utf8", timeout: 40_000 }, (error, out, err) => error ? reject(new Error(err || error.message)) : resolve(out.trim()));
  child.stdin!.end(`set statement_timeout='30s';set lock_timeout='5s';set role ${role};begin;${statement};select pg_sleep(0.1);commit;`);
});
const funder = privateKeyToAccount(generatePrivateKey()), spend = privateKeyToAccount(generatePrivateKey());
const operation = validateGatewayFundingOperation({ format: "gateway-funding-operation-v1", policy: {
  format: "gateway-funding-policy-v1", identity, policyId: randomUUID(), funder: funder.address.toLowerCase(), spend: spend.address.toLowerCase(),
  lifetimeLimits: { nativeWei: "50", usdcMicros: "100", depositMicros: "100", gasWei: "2610000" }, maxTransactionGas: "120000", maxFeePerGasWei: "10" },
  operationId: randomUUID(), ownerAuthorizationId: randomUUID(), ownerAuthorizationDigest: "b".repeat(64), minimumAvailableMicros: "100", initialAvailableMicros: "0",
  nativeTransferWei: "50", usdcTransferMicros: "100", approvalMicros: "100", depositMicros: "100", gasLimits: {
    nativeTransfer: "21000", usdcTransfer: "60000", approval: "60000", deposit: "120000" }, maxFeePerGasWei: "10", maxPriorityFeePerGasWei: "1" });
let started = false, httpStarted = false, observerHttpStarted = false;
try {
  try { docker(["info", "--format", "{{.ServerVersion}}"]); } catch { throw new Error("Isolated PostgreSQL acceptance requires the existing Docker engine; gate did not run"); }
  docker(["run", "-d", "--name", name, "--network", "none", "--memory", "512m", "--cpus", "1", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17"]); started = true;
  let ready = false;
  for (let i = 0; i < 30; i++) { try { docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  assert(ready, "isolated PostgreSQL startup deadline");
  // Candidate authority SQL is deliberately outside deployment discovery.
  // Only this network-isolated synthetic acceptance process consumes it.
  const historical = readdirSync("supabase/migrations").filter(f => /^\d{4}.*\.sql$/.test(f) && Number(f.slice(0, 4)) < 70).sort();
  const candidates = readdirSync("scripts/test-fixtures/funding-postgres").filter(f => /^007[0-5].*\.sql$/.test(f)).sort();
  assert.equal(candidates.length, 6, "complete quarantined authority fixture closure");
  const migrations = [...historical.map(f => `supabase/migrations/${f}`), ...candidates.map(f => `scripts/test-fixtures/funding-postgres/${f}`)];
  sql("create role anon;create role authenticated;create role service_role bypassrls;create publication supabase_realtime;" + migrations.map(f => normalizeFundingSnapshotMigration(readFileSync(f, "utf8"))).join("\n"));
  sql("create database funding_unenrolled template postgres");
  const reviewed = sql("select keryx_storage.snapshot_digest()");
  sql(`select keryx_storage.enroll(${expected},'${reviewed}')`);
  const binding = sql("select keryx_storage.funding_backend_binding()");
  assert.match(binding, /^[0-9a-f]{64}$/);
  assert.equal(sql(`select keryx_storage.funding_digest(${json(operation)})`), gatewayFundingReplayDigest(operation), "SQL canonical operation digest matches code");
  const installation: FundingOwnerInstallation = { format: "gateway-funding-owner-installation-v1", policy: operation.policy,
    funderGasBudgetWei: "810000", spendGasBudgetWei: "1800000", reviewedSnapshotDigest: sql("select keryx_storage.snapshot_digest()"), reviewedTargetDigest: binding,
    finalityPolicyDigest: "e".repeat(64), history: { format: "gateway-funding-empty-isolated-history-v1", documentDigest: "c".repeat(64), funderInitialNonce: "0", spendInitialNonce: "0" } };
  assert.throws(() => service(`select keryx_storage.install_funding_policy(${expected},${json(installation)})`), /permission denied/);
  sql(`select keryx_storage.install_funding_policy(${expected},${json(installation)})`);
  sql(`select keryx_storage.install_funding_policy(${expected},${json(installation)})`);
  const originalNamespace = JSON.parse(sql(`select to_jsonb(n) from public.gateway_funding_namespaces n where sender='${operation.policy.funder}'`));
  // Owner-only synthetic pre-enrollment import fixture. Restored fences must
  // refuse unexplained legacy ledger state instead of attesting it spendable.
  sqlIn("funding_unenrolled", `alter table public.gateway_funding_namespaces disable trigger user;
    insert into public.gateway_funding_namespaces select (jsonb_populate_record(null::public.gateway_funding_namespaces,${json(originalNamespace)})).*;
    alter table public.gateway_funding_namespaces enable trigger user;`);
  const importedSnapshot = sqlIn("funding_unenrolled", "select keryx_storage.snapshot_digest()");
  assert.throws(() => sqlIn("funding_unenrolled", `select keryx_storage.enroll(${expected},'${importedSnapshot}')`), /Gateway funding ledger refused/);
  assert.equal(sqlIn("funding_unenrolled", "select count(*) from public.gateway_funding_namespaces"), "1");
  assert.equal(sqlIn("funding_unenrolled", "select count(*) from keryx_storage.identity"), "0");
  sql(`select keryx_storage.install_funding_authorization(${expected},${json(operation)})`);
  // Refuse before identity/catalog/lock admission. Timeout is established by
  // the outer SQL statement/session, never by a funding function SET clause.
  const beforeDeadlineRefusals = sql("select keryx_storage.snapshot_digest()");
  for (const timeout of ["0", "30001ms"]) {
    for (const command of [
      `select keryx_storage.install_funding_policy(${expected},${json(installation)})`,
      `select keryx_storage.install_funding_authorization(${expected},${json(operation)})`,
      rpc("inspect_namespace", `'${operation.policy.funder}'`),
      rpc("admit", `'${operation.operationId}'`),
    ]) assert.throws(() => sql(`set statement_timeout='${timeout}';${command}`), /Gateway funding outer statement deadline required/);
    assert.equal(sql("select keryx_storage.snapshot_digest()"), beforeDeadlineRefusals, "deadline refusal preserves complete store");
    assert.equal(sql("select count(*) from keryx_storage.writer"), "0", "deadline refusal admits no writer");
  }
  // One actual outer statement includes admission and then blocks. Cancellation
  // must roll back that admission and its writer, rather than leave authority.
  assert.throws(() => sql(`set statement_timeout='1s';do $$ begin
    perform public.storage_funding_admit(${expected},'${operation.operationId}');
    raise notice 'Synthetic funding reached sleep';
    perform pg_sleep(2);end $$`), error => {
    assert.match(String(error), /Synthetic funding reached sleep/, "funding mutation completed before the blocked sleep");
    assert.match(String(error), /canceling statement due to statement timeout/);
    return true;
  });
  assert.equal(sql("select keryx_storage.snapshot_digest()"), beforeDeadlineRefusals, "outer timeout rolls back funding mutation");
  assert.equal(sql("select count(*) from keryx_storage.writer"), "0");

  sql("grant execute on function public.storage_funding_finalize(jsonb,jsonb) to anon");
  assert.throws(() => service(rpc("admit", `'${operation.operationId}'`)), /Gateway funding ledger refused/, "ACL drift must refuse ordinary admission");
  sql("revoke execute on function public.storage_funding_finalize(jsonb,jsonb) from anon");
  sql("alter role keryx_gateway_funding_observer login");
  assert.throws(() => service(rpc("admit", `'${operation.operationId}'`)), /Gateway funding ledger refused/, "unsafe observer drift must refuse ordinary admission");
  sql("alter role keryx_gateway_funding_observer nologin");
  for (const role of ["anon", "authenticated", "service_role", "keryx_gateway_funding_observer"]) {
    for (const command of ["select * from public.gateway_funding_namespaces", "truncate public.gateway_funding_namespaces", "update public.gateway_funding_namespaces set next_nonce=0"]) {
      assert.throws(() => sql(`set role ${role};${command}`), /permission denied/);
    }
  }
  assert.throws(() => service("insert into keryx_storage.writer values(txid_current(),'x','funding_install_policy')"), /permission denied/);
  assert.throws(() => service(`select public.storage_funding_admit(${json({ ...identity, deploymentId: randomUUID() })},'${operation.operationId}')`), /identity_mismatch/);
  assert.throws(() => service(`select public.storage_funding_admit(${json({ ...identity, authorityMode: "testnet-offline" })},'${operation.operationId}')`), /identity_mismatch/);
  // Two OS processes compete for the same last budget. Exact replay consumes it
  // once; a second separately owner-authorized operation cannot add allowance.
  const admission = await Promise.all([concurrent(rpc("admit", `'${operation.operationId}'`)), concurrent(rpc("admit", `'${operation.operationId}'`))]);
  assert.equal(admission.length, 2);
  assert.equal(sql("select count(*) from public.gateway_funding_operations"), "1");
  const exhausted = { ...operation, operationId: randomUUID(), ownerAuthorizationId: randomUUID() };
  sql(`select keryx_storage.install_funding_authorization(${expected},${json(exhausted)})`);
  assert.throws(() => service(rpc("admit", `'${exhausted.operationId}'`)), /Gateway funding ledger refused/);
  const racePolicy = { ...operation.policy, policyId: randomUUID(), funder: privateKeyToAccount(generatePrivateKey()).address.toLowerCase(),
    spend: privateKeyToAccount(generatePrivateKey()).address.toLowerCase() };
  const raceOperations = [0, 1].map(() => ({ ...operation, policy: racePolicy, operationId: randomUUID(), ownerAuthorizationId: randomUUID() }));
  sql(`select keryx_storage.install_funding_policy(${expected},${json({ ...installation, policy: racePolicy, reviewedSnapshotDigest: sql("select keryx_storage.snapshot_digest()") })})`);
  for (const op of raceOperations) sql(`select keryx_storage.install_funding_authorization(${expected},${json(op)})`);
  const competingAdmission = await Promise.allSettled(raceOperations.map(op => concurrent(rpc("admit", `'${op.operationId}'`))));
  assert.equal(competingAdmission.filter(r => r.status === "fulfilled").length, 1, "only one distinct operation gets the last lifetime budget");
  const winner = raceOperations[competingAdmission.findIndex(r => r.status === "fulfilled")];
  const competingNonce = await Promise.allSettled((["nativeTransfer", "usdcTransfer"] as const).map(selectedStep => concurrent(rpc("reserve", `'${winner.operationId}'`, `'${selectedStep}'`, json(prepareGatewayFundingTransaction(winner, selectedStep, "0"))))));
  assert.equal(competingNonce.filter(r => r.status === "fulfilled").length, 1, "distinct original steps cannot share a sender nonce");
  const winningStep = competingNonce[0].status === "fulfilled" ? "nativeTransfer" : "usdcTransfer";
  const rolledBack = randomUUID();
  service(`begin;${rpc("claim_crypto", `'${winner.operationId}'`, `'${winningStep}'`, `'${rolledBack}'`)};rollback;`);
  assert.equal(sql(`select count(*) from public.gateway_funding_crypto_claims where claim_id='${rolledBack}'`), "0", "uncommitted claim cannot survive rollback");
  const native = prepareGatewayFundingTransaction(operation, "nativeTransfer", "0");
  await Promise.all([concurrent(rpc("reserve", `'${operation.operationId}'`, "'nativeTransfer'", json(native))), concurrent(rpc("reserve", `'${operation.operationId}'`, "'nativeTransfer'", json(native)))]);
  assert.equal(sql(`select next_nonce from public.gateway_funding_namespaces where sender='${native.sender}'`), "1");
  const claimId = randomUUID();
  const claims = await Promise.all([concurrent(rpc("claim_crypto", `'${operation.operationId}'`, "'nativeTransfer'", `'${claimId}'`)), concurrent(rpc("claim_crypto", `'${operation.operationId}'`, "'nativeTransfer'", `'${claimId}'`))]);
  assert.equal(claims.filter(s => s.includes('"fresh": true')).length, 1);
  assert.equal(claims.filter(s => s.includes('"fresh": false')).length, 1);
  assert.throws(() => service(rpc("claim_crypto", `'${operation.operationId}'`, "'nativeTransfer'", `'${randomUUID()}'`)), /Gateway funding ledger refused/);
  const usdc = prepareGatewayFundingTransaction(operation, "usdcTransfer", "1");
  service(rpc("reserve", `'${operation.operationId}'`, "'usdcTransfer'", json(usdc)));
  assert.throws(() => service(rpc("claim_crypto", `'${operation.operationId}'`, "'usdcTransfer'", `'${randomUUID()}'`)), /Gateway funding ledger refused/);
  // Caught failure inside an outer transaction must not leave a writer context.
  sql(`set role service_role;do $$begin begin perform public.storage_funding_claim_crypto(${expected},'${operation.operationId}','usdcTransfer','${randomUUID()}');exception when others then null;end;end$$;`);
  assert.equal(sql("select count(*) from keryx_storage.writer"), "0");
  const rawTransaction = await funder.signTransaction(parseTransaction(native.serializedUnsigned));
  const transactionHash = keccak256(rawTransaction);
  service(rpc("save_prepared", `'${operation.operationId}'`, "'nativeTransfer'", `'${claimId}'`, `'${rawTransaction}'`, `'${transactionHash}'`));
  const sendId = randomUUID();
  const sends = await Promise.all([concurrent(rpc("claim_broadcast", `'${operation.operationId}'`, "'nativeTransfer'", `'${sendId}'`)), concurrent(rpc("claim_broadcast", `'${operation.operationId}'`, "'nativeTransfer'", `'${sendId}'`))]);
  assert.equal(sends.filter(s => s.includes('"fresh": true')).length, 1);
  assert.throws(() => service(rpc("claim_broadcast", `'${operation.operationId}'`, "'nativeTransfer'", `'${randomUUID()}'`)), /Gateway funding ledger refused/);
  const candidate = { format: "gateway-funding-candidate-observation-v1", observationId: randomUUID(), operationId: operation.operationId,
    step: "nativeTransfer", transactionHash, status: "seen", observedAt: "2026-10-01T00:00:00.000Z", evidenceDigest: "a".repeat(64) };
  service(rpc("append_observation", json(candidate)));
  assert.throws(() => service(rpc("claim_crypto", `'${operation.operationId}'`, "'usdcTransfer'", `'${randomUUID()}'`)), /Gateway funding ledger refused/);
  const prepared = { format: "gateway-funding-signed-transaction-v1" as const, transaction: native, rawTransaction, transactionHash };
  const evidence: FundingTerminalEvidence = { format: "gateway-funding-terminal-evidence-v1", identity, identityDigest: sql(`select keryx_storage.identity_digest(${expected})`),
    operationDigest: gatewayFundingReplayDigest(operation), operationId: operation.operationId, step: "nativeTransfer", transactionHash, cryptoClaimId: claimId,
    broadcastClaimId: sendId, prepared, sender: native.sender, nonce: "0", chainId: "5042002", receiptStatus: "success", blockNumber: "10", blockHash: `0x${"1".repeat(64)}`,
    gasUsed: "21000", effectiveGasPriceWei: "1", observedAt: "2026-10-01T00:00:00.000Z", finalityPolicyDigest: installation.finalityPolicyDigest,
    finalizedBlockNumber: "12", finalizedBlockHash: `0x${"2".repeat(64)}`, providerEvidenceDigest: "f".repeat(64) };
  assert.throws(() => service(rpc("finalize", json(evidence))), /permission denied/);
  // Synthetic role-boundary fixture: these invented receipt fields demonstrate
  // SQL binding/ACL only, never verified provider truth or actual settlement.
  sql("create role synthetic_observer login;grant keryx_gateway_funding_observer to synthetic_observer");
  const beforeObserverDeadline = sql("select keryx_storage.snapshot_digest()");
  for (const timeout of ["0", "30001ms"]) {
    assert.throws(() => sql(`set statement_timeout='${timeout}';set role synthetic_observer;${rpc("finalize", json(evidence))}`), /Gateway funding outer statement deadline required/);
    assert.equal(sql("select keryx_storage.snapshot_digest()"), beforeObserverDeadline);
    assert.equal(sql("select count(*) from keryx_storage.writer"), "0");
  }

  assert.throws(() => sql(`set role synthetic_observer;${rpc("finalize", json({ ...evidence, finalityPolicyDigest: "0".repeat(64) }))}`), /Gateway funding ledger refused/);
  sql(`set role synthetic_observer;begin;${rpc("finalize", json(evidence))};rollback;`);
  assert.equal(sql(`select next_crypto_nonce from public.gateway_funding_namespaces where sender='${native.sender}'`), "0", "terminal and barrier roll back together");
  assert.equal(sql("select count(*) from public.gateway_funding_observations where kind like 'finalized-%'"), "0");
  await Promise.all([concurrent(rpc("finalize", json(evidence)), "synthetic_observer"), concurrent(rpc("finalize", json(evidence)), "synthetic_observer")]);
  sql(`set role synthetic_observer;${rpc("finalize", json(evidence))}`);
  assert.equal(sql(`select next_crypto_nonce from public.gateway_funding_namespaces where sender='${native.sender}'`), "1", "exact terminal replay advances the barrier once");
  const followingClaim = randomUUID();
  service(rpc("claim_crypto", `'${operation.operationId}'`, "'usdcTransfer'", `'${followingClaim}'`));
  assert.equal(sql("select count(*) from keryx_storage.writer"), "0");
  // Restart the database after an irreversible claim, then keylessly read back:
  // original UUID stays consumed and an exact replay is not fresh authority.
  docker(["kill", "--signal", "KILL", name]);
  docker(["start", name]);
  ready = false;
  for (let i = 0; i < 30; i++) { try { docker(["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "postgres"]); ready = true; break; } catch { await new Promise(r => setTimeout(r, 100)); } }
  assert(ready);
  assert.equal(sql(`select next_crypto_nonce from public.gateway_funding_namespaces where sender='${native.sender}'`), "1", "SIGKILL retains the protected progression barrier");
  assert.equal(JSON.parse(service(rpc("claim_crypto", `'${operation.operationId}'`, "'usdcTransfer'", `'${followingClaim}'`))).fresh, false);
  sql("create role funding_http login;alter role funding_http set statement_timeout='10s';grant service_role to funding_http");
  docker(["run", "-d", "--name", httpName, "--network", `container:${name}`, "--memory", "256m", "--cpus", "0.5", "-e", "PGRST_DB_URI=postgres://funding_http@127.0.0.1:5432/postgres",
    "-e", "PGRST_DB_ANON_ROLE=service_role", "-e", "PGRST_DB_SCHEMAS=public", "-e", "PGRST_DB_CONFIG=false", "-e", "PGRST_DB_POOL=2", "postgrest/postgrest:v12.2.3"]); httpStarted = true;
  const isolatedHttpFetch = (port: 3000 | 3001): typeof fetch => async (input, init) => {
    const path = new URL(String(input)).pathname.replace(/^\/rest\/v1/, "");
    if (!/^\/rpc\/(read_storage_identity|storage_funding_[a-z_]+)$/.test(path)) throw new Error("Unexpected synthetic HTTP operation");
    const output = docker(["run", "--rm", "-i", "--network", `container:${name}`, "--memory", "64m", "--cpus", "0.25", "curlimages/curl:8.12.1", "--max-time", "10", "--silent", "--show-error", "--request", "POST",
      "--header", "Content-Type: application/json", "--data-binary", "@-", "--write-out", "\n%{http_code}", `http://127.0.0.1:${port}${path}`], String(init?.body ?? "{}"));
    const split = output.lastIndexOf("\n"), status = Number(output.slice(split + 1));
    return new Response(status === 204 ? null : output.slice(0, split), { status, headers: { "Content-Type": "application/json" } });
  };
  const httpFetch = isolatedHttpFetch(3000);
  const authority = new SupabaseAuthority(createClient("http://synthetic.invalid", "synthetic-no-authority", { auth: { persistSession: false }, global: { fetch: httpFetch } }), identity);
  let httpReady = false;
  for (let i = 0; i < 10; i++) { try { await authority.init(); httpReady = true; break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  assert(httpReady, "isolated PostgREST startup deadline");
  const ledger = new SupabaseGatewayFundingLedger(authority);
  assert.equal(await ledger.inspectOperation(randomUUID()), null, "scalar SQL null is actual HTTP null");
  assert.deepEqual(await ledger.inspectOperation(operation.operationId), operation);
  const namespace = await ledger.inspectNamespace(native.sender);
  assert.equal(namespace.nativeAggregateUsedWei, (BigInt(50) + BigInt(100) * BigInt(10) ** BigInt(12) + BigInt(810000)).toString());
  assert.equal((await ledger.inspectReservation(operation.operationId, "nativeTransfer"))?.prepared?.rawTransaction, rawTransaction);
  assert.equal((await ledger.claimBroadcast(operation.operationId, "nativeTransfer", sendId)).fresh, false);
  // Execute an actual HTTP mutation, discard its committed response, then
  // recover keylessly. No new key, transaction signature or physical send.
  let loseResponse = true;
  const lostAckAuthority = new SupabaseAuthority(createClient("http://synthetic.invalid", "synthetic-no-authority", { auth: { persistSession: false }, global: {
    fetch: async (input, init) => { const response = await httpFetch(input, init);
      if (loseResponse && String(input).includes("storage_funding_claim_broadcast")) { loseResponse = false; throw new Error("Synthetic lost committed HTTP acknowledgement"); }
      return response; } } }), identity);
  await lostAckAuthority.init();
  const lostAckLedger = new SupabaseGatewayFundingLedger(lostAckAuthority);
  const usdcRawTransaction = await funder.signTransaction(parseTransaction(usdc.serializedUnsigned));
  await lostAckLedger.savePrepared(operation.operationId, "usdcTransfer", followingClaim, { rawTransaction: usdcRawTransaction, transactionHash: keccak256(usdcRawTransaction) });
  const lostSendId = randomUUID();
  await assert.rejects(() => lostAckLedger.claimBroadcast(operation.operationId, "usdcTransfer", lostSendId), /Gateway funding ledger refused/);
  assert.equal((await lostAckLedger.claimBroadcast(operation.operationId, "usdcTransfer", lostSendId)).fresh, false);
  assert.equal((await lostAckLedger.inspectReservation(operation.operationId, "usdcTransfer"))?.prepared?.rawTransaction, usdcRawTransaction);
  lostAckLedger.close();
  // Actual protected adapter composition: generated original signature + PR74
  // WeakMap issuer provenance + real observer-role PostgREST. Provider responses
  // below are synthetic; this proves capability composition, not chain truth.
  const issuerFunder = privateKeyToAccount(generatePrivateKey()), issuerSpend = privateKeyToAccount(generatePrivateKey());
  const issuerOperation = validateGatewayFundingOperation({ ...operation, initialAvailableMicros: "90", operationId: randomUUID(), ownerAuthorizationId: randomUUID(), policy: {
    ...operation.policy, policyId: randomUUID(), funder: issuerFunder.address.toLowerCase(), spend: issuerSpend.address.toLowerCase() } });
  sql(`select keryx_storage.install_funding_policy(${expected},${json({ ...installation, policy: issuerOperation.policy,
    finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST, reviewedSnapshotDigest: sql("select keryx_storage.snapshot_digest()") })})`);
  sql(`select keryx_storage.install_funding_authorization(${expected},${json(issuerOperation)})`);
  await ledger.admitOperation(issuerOperation.operationId);
  const issuerReservation = await ledger.reserveStep(issuerOperation.operationId, "nativeTransfer", "0");
  const issuerCryptoId = randomUUID(), issuerSendId = randomUUID();
  await ledger.claimCrypto(issuerOperation.operationId, "nativeTransfer", issuerCryptoId);
  const issuerRaw = await issuerFunder.signTransaction(parseTransaction(issuerReservation.transaction.serializedUnsigned));
  const issuerPrepared = (await ledger.savePrepared(issuerOperation.operationId, "nativeTransfer", issuerCryptoId,
    { rawTransaction: issuerRaw, transactionHash: keccak256(issuerRaw) })).prepared!;
  await ledger.claimBroadcast(issuerOperation.operationId, "nativeTransfer", issuerSendId);
  const issuerRequest = { operation: issuerOperation, prepared: issuerPrepared, cryptoClaimId: issuerCryptoId, broadcastClaimId: issuerSendId,
    finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST };
  const observationTime = 1800000000000, inclusionHash = `0x${"3".repeat(64)}`, anchorHash = `0x${"4".repeat(64)}`;
  const q = (value: string | number) => `0x${BigInt(value).toString(16)}`, issuerTx = issuerPrepared.transaction;
  const syntheticProviderFetchFor = (original: Readonly<SignedGatewayFundingTransaction>): typeof fetch => {
    const signature = parseTransaction(original.rawTransaction), issuerTx = original.transaction, issuerPrepared = original;
    return async (input, options) => {
      assert([GATEWAY_FUNDING_RECEIPT_POLICY.primary, GATEWAY_FUNDING_RECEIPT_POLICY.secondary].includes(String(input) as typeof GATEWAY_FUNDING_RECEIPT_POLICY.primary));
      const body = JSON.parse(options!.body as string); let result: unknown;
      if (body.method === "eth_chainId") result = q(5042002);
      else if (body.method === "eth_getTransactionByHash") result = { hash: issuerPrepared.transactionHash, from: issuerTx.sender, to: issuerTx.to, input: issuerTx.data,
        type: "0x2", chainId: q(issuerTx.chainId), nonce: q(issuerTx.nonce), value: q(issuerTx.valueWei), gas: q(issuerTx.gas), maxFeePerGas: q(issuerTx.maxFeePerGasWei),
        maxPriorityFeePerGas: q(issuerTx.maxPriorityFeePerGasWei), accessList: [], r: signature.r, s: signature.s, yParity: q(signature.yParity!), blockNumber: "0xa", blockHash: inclusionHash, transactionIndex: "0x0" };
      else if (body.method === "eth_getTransactionReceipt") result = { transactionHash: issuerPrepared.transactionHash, from: issuerTx.sender, to: issuerTx.to,
        type: "0x2", status: "0x1", gasUsed: "0x100", effectiveGasPrice: "0x1", blockNumber: "0xa", blockHash: inclusionHash, transactionIndex: "0x0" };
      else if (body.method === "eth_getBlockByNumber") result = body.params[0] === "0xa" ? { number: "0xa", hash: inclusionHash,
        timestamp: q(observationTime / 1000 - 2), transactions: [issuerPrepared.transactionHash] } : { number: "0xb", hash: anchorHash, timestamp: q(observationTime / 1000 - 1), transactions: [] };
      else throw new Error("Unexpected synthetic observer method");
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { headers: { "Content-Type": "application/json" } });
    };
  };
  const token = await createGatewayFundingReceiptObserverForTrustedComposition(syntheticProviderFetchFor(issuerPrepared), () => observationTime)(issuerRequest, () => { ledger.getStorageIdentity(); });
  assert(token, "controlled synthetic issuer must produce actual opaque provenance");
  const retainedIssuer = await ledger.inspectReservation(issuerOperation.operationId, "nativeTransfer");
  assert(retainedIssuer?.prepared);
  const retainedIssuerRequest = { operation: retainedIssuer.operation, prepared: retainedIssuer.prepared,
    cryptoClaimId: retainedIssuer.cryptoClaimId!, broadcastClaimId: retainedIssuer.broadcastClaimId!,
    finalityPolicyDigest: (await ledger.inspectNamespace(issuerOperation.policy.funder)).finalityPolicyDigest };
  assert.deepEqual(retainedIssuerRequest, issuerRequest, "original issuer request equals complete PG readback");
  unsealVerifiedGatewayFundingReceipt(token, issuerRequest, () => {});
  unsealVerifiedGatewayFundingReceipt(token, retainedIssuerRequest, () => {});
  const ordinaryObserverStore = new SupabaseGatewayFundingTerminalObserverStore(ledger, authority);
  await assert.rejects(() => ordinaryObserverStore.appendVerifiedTerminalObservation(issuerOperation.operationId, "nativeTransfer", token), /Gateway funding observer refused/);
  assert.equal((await ledger.inspectNamespace(issuerTx.sender)).nextCryptoNonce, "0");
  sql("create role funding_observer_http login;alter role funding_observer_http set statement_timeout='10s';grant keryx_gateway_funding_observer to funding_observer_http");
  docker(["run", "-d", "--name", observerHttpName, "--network", `container:${name}`, "--memory", "256m", "--cpus", "0.5",
    "-e", "PGRST_DB_URI=postgres://funding_observer_http@127.0.0.1:5432/postgres", "-e", "PGRST_DB_ANON_ROLE=keryx_gateway_funding_observer",
    "-e", "PGRST_DB_SCHEMAS=public", "-e", "PGRST_DB_CONFIG=false", "-e", "PGRST_DB_POOL=2", "-e", "PGRST_SERVER_PORT=3001", "postgrest/postgrest:v12.2.3"]); observerHttpStarted = true;
  const observerFetch = isolatedHttpFetch(3001); let loseTerminalAck = true;
  const observerAuthority = new SupabaseAuthority(createClient("http://synthetic.invalid", "synthetic-no-authority", { auth: { persistSession: false }, global: {
    fetch: async (input, init) => { const response = await observerFetch(input, init);
      if (loseTerminalAck && String(input).includes("storage_funding_finalize")) { loseTerminalAck = false; throw new Error("Synthetic lost terminal HTTP acknowledgement"); }
      return response; } } }), identity);
  let observerReady = false;
  for (let i = 0; i < 10; i++) { try { await observerAuthority.init(); observerReady = true; break; } catch { await new Promise(r => setTimeout(r, 200)); } }
  assert(observerReady);
  const observerStore = new SupabaseGatewayFundingTerminalObserverStore(ledger, observerAuthority);
  await assert.rejects(() => observerStore.appendVerifiedTerminalObservation(issuerOperation.operationId, "nativeTransfer", {} as typeof token));
  await assert.rejects(() => observerStore.appendVerifiedTerminalObservation(issuerOperation.operationId, "nativeTransfer", token), /Gateway funding observer refused/);
  const retainedTerminal = await ledger.inspectReservation(issuerOperation.operationId, "nativeTransfer");
  assert.equal(retainedTerminal?.state, "finalized-success", "lost terminal ACK retains committed original evidence");
  assert.equal(retainedTerminal?.terminal?.finalityPolicyDigest, GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST);
  await observerStore.appendVerifiedTerminalObservation(issuerOperation.operationId, "nativeTransfer", token);
  assert.equal((await ledger.inspectNamespace(issuerTx.sender)).nextCryptoNonce, "1", "exact protected replay never advances the barrier again");
  await testPostgresFundingReadiness({ ledger, operation: issuerOperation, backendBindingDigest: binding, sql,
    refusedRoleInspection: async role => {
      assert.throws(() => sql(`set role ${role};${rpc("inspect_operation", `'${issuerOperation.operationId}'`)}`), /permission denied/);
    },
    finalizeDeposit: async () => {
      const slot = await ledger.reserveStep(issuerOperation.operationId, "deposit", "0");
      const cryptoId = randomUUID(), sendId = randomUUID();
      assert.equal((await ledger.claimCrypto(issuerOperation.operationId, "deposit", cryptoId)).fresh, true);
      const raw = await issuerSpend.signTransaction(parseTransaction(slot.transaction.serializedUnsigned));
      const original = (await ledger.savePrepared(issuerOperation.operationId, "deposit", cryptoId,
        { rawTransaction: raw, transactionHash: keccak256(raw) })).prepared!;
      assert.equal((await ledger.claimBroadcast(issuerOperation.operationId, "deposit", sendId)).fresh, true);
      const receipt = await createGatewayFundingReceiptObserverForTrustedComposition(syntheticProviderFetchFor(original), () => observationTime)(
        { operation: issuerOperation, prepared: original, cryptoClaimId: cryptoId, broadcastClaimId: sendId,
          finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST }, () => { ledger.getStorageIdentity(); });
      assert(receipt); await observerStore.appendVerifiedTerminalObservation(issuerOperation.operationId, "deposit", receipt);
    },
    changeNamespace: async () => { await ledger.reserveStep(issuerOperation.operationId, "approval", "1"); },
  });
  observerStore.close(); ordinaryObserverStore.close();
  docker(["rm", "-f", "-v", observerHttpName]); observerHttpStarted = false;
  const beforeRollover = await ledger.inspectNamespace(native.sender);
  const rollover = { ...installation, policy: { ...operation.policy, policyId: randomUUID() }, reviewedSnapshotDigest: sql("select keryx_storage.snapshot_digest()") };
  sql(`select keryx_storage.install_funding_policy(${expected},${json(rollover)})`);
  assert.deepEqual(await ledger.inspectNamespace(native.sender), beforeRollover, "a new owner policy UUID cannot reset used exposure or original nonces");
  for (const changes of [
    { history: { ...installation.history, documentDigest: "0".repeat(64) } },
    { finalityPolicyDigest: "0".repeat(64) },
    { policy: { ...operation.policy, policyId: randomUUID(), lifetimeLimits: { ...operation.policy.lifetimeLimits, nativeWei: "51" } } },
    { policy: { ...operation.policy, policyId: randomUUID(), spend: privateKeyToAccount(generatePrivateKey()).address.toLowerCase() } },
  ]) {
    const unchanged = sql("select keryx_storage.snapshot_digest()");
    assert.throws(() => sql(`select keryx_storage.install_funding_policy(${expected},${json({ ...installation, policy: { ...operation.policy, policyId: randomUUID() }, ...changes, reviewedSnapshotDigest: unchanged })})`), /Gateway funding ledger refused/);
    assert.equal(sql("select keryx_storage.snapshot_digest()"), unchanged, "refused policy/history/counterparty drift preserves the whole store");
  }
  const usedKeyPolicy = { ...operation.policy, policyId: randomUUID(), funder: privateKeyToAccount(generatePrivateKey()).address.toLowerCase(), spend: privateKeyToAccount(generatePrivateKey()).address.toLowerCase() };
  sql(`begin;select keryx_storage.enter_operation(${expected},'record_payment');
    insert into public.payment_events(id,kind,query_id,source_id,payer,payee,amount_usdc,network,settled,settlement_status)
    values('synthetic-prior-key-authority','fetch','synthetic','synthetic','${usedKeyPolicy.funder}','${usedKeyPolicy.spend}',0.000001,'eip155:5042002',false,'pending');
    select keryx_storage.leave_operation();commit;`);
  const priorKeySnapshot = sql("select keryx_storage.snapshot_digest()");
  assert.throws(() => sql(`select keryx_storage.install_funding_policy(${expected},${json({ ...installation, policy: usedKeyPolicy, reviewedSnapshotDigest: priorKeySnapshot })})`), /Gateway funding ledger refused/);
  assert.equal(sql("select keryx_storage.snapshot_digest()"), priorKeySnapshot, "known prior key authority cannot be newly owner-attested as empty");
  ledger.close();
  docker(["rm", "-f", "-v", httpName]); httpStarted = false;
  sql("create database funding_logical_clone template postgres");
  assert.notEqual(sqlIn("funding_logical_clone", "select keryx_storage.funding_backend_binding()"), binding, "a logical copy gets a distinct native database identity");
  assert.throws(() => sqlIn("funding_logical_clone", `set role service_role;${rpc("admit", `'${operation.operationId}'`)}`), /Gateway funding ledger refused/);
  assert.throws(() => sqlIn("funding_logical_clone", `select keryx_storage.install_funding_policy(${expected},${json(installation)})`), /Gateway funding ledger refused/);
  assert.equal(JSON.parse(sqlIn("funding_logical_clone", `set role service_role;${rpc("inspect_reservation", `'${operation.operationId}'`, "'nativeTransfer'")}`)).prepared.rawTransaction, rawTransaction,
    "keyless inspection of copied evidence grants no mutation authority");
  await assert.rejects(() => ledger.inspectOperation(operation.operationId), /Gateway funding ledger refused/);
  console.log("Actual isolated PostgreSQL17 and PostgREST funding candidate acceptance passed; provider truth/physical-clone exclusivity remain open.");
} finally {
  if (observerHttpStarted) docker(["rm", "-f", "-v", observerHttpName]);
  if (httpStarted) docker(["rm", "-f", "-v", httpName]);
  if (started) docker(["rm", "-f", "-v", name]);
}
