import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { canonicalJson } from "../lib/canonical-json";
import { postgresSnapshotDiagnosticSql, postgresSnapshotDiagnosticChanges } from "./helpers/postgres-snapshot-diagnostics.mts";
import type { GatewayFundingLedger } from "../lib/db/gateway-funding-ledger-types";
import type { GatewayFundingOperation } from "../lib/payments/gateway-funding-policy";
import { GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST } from "../lib/payments/gateway-funding-receipt-policy";
import { createGatewayFundingReadinessObserverForTrustedSyntheticComposition,
  assertVerifiedGatewayFundingReadinessCurrent, unsealVerifiedGatewayFundingReadiness,
  type GatewayFundingReadinessRequest, type VerifiedGatewayFundingReadiness } from "../lib/payments/gateway-funding-readiness";

/** Actual PG/PostgREST inspection only; Circle responses below are invented,
 * descriptive current availability, never deposit credit or external truth. */
export async function testPostgresFundingReadiness(context: {
  ledger: GatewayFundingLedger; operation: Readonly<GatewayFundingOperation>; backendBindingDigest: string;
  sql: (statement: string) => string; finalizeDeposit: () => Promise<void>;
  changeNamespace: () => Promise<void>; refusedRoleInspection: (role: "anon" | "authenticated") => Promise<void>;
}) {
  let calls = 0, mode: "available" | "insufficient" | "malformed" | "outage" | "redirect" = "available";
  const server = createServer((request, response) => {
    calls++;
    assert.equal(request.method, "POST"); assert.equal(request.url, "/v1/balances");
    let body = "";
    request.on("data", chunk => { body += String(chunk); });
    request.on("end", () => {
      assert.deepEqual(JSON.parse(body), { token: "USDC", sources: [{ depositor: context.operation.policy.spend, domain: 26 }] });
      response.setHeader("Connection", "close"); response.setHeader("Content-Type", "application/json");
      if (mode === "outage") { response.writeHead(503); response.end("{}"); return; }
      if (mode === "redirect") { response.writeHead(302, { Location: "/v1/balances" }); response.end(); return; }
      response.end(JSON.stringify(mode === "malformed" ? { token: "USDC", balances: [] } : {
        token: "USDC", balances: [{ depositor: context.operation.policy.spend, domain: 26,
          balance: mode === "insufficient" ? "0.000099" : "0.000100" }], withdrawing: "999999" }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); assert(address && typeof address !== "string");
  const observe = createGatewayFundingReadinessObserverForTrustedSyntheticComposition(`http://127.0.0.1:${address.port}/v1/balances`);
  let mutationCalls = 0, reservationReads = 0;
  const reads = new Set(["getStorageIdentity", "inspectOperation", "inspectNamespace", "inspectReservation"]);
  const readonlyLedger = new Proxy(context.ledger, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (typeof value !== "function") return value;
    if (!reads.has(String(property))) return () => { mutationCalls++; throw new Error("Readiness attempted a mutation"); };
    return (...args: unknown[]) => { if (property === "inspectReservation") reservationReads++; return value.apply(target, args); };
  } });
  const request: GatewayFundingReadinessRequest = { ledger: readonlyLedger, operationId: context.operation.operationId,
    expectedIdentity: context.ledger.getStorageIdentity(), expectedBackendBindingDigest: context.backendBindingDigest,
    installedPolicyDigest: createHash("sha256").update(canonicalJson(context.operation.policy)).digest("hex"),
    finalityPolicyDigest: GATEWAY_FUNDING_RECEIPT_POLICY_DIGEST, assertCurrentAuthority: () => {} };
  const snapshot = async () => ({ store: context.sql("select keryx_storage.snapshot_digest()"),
    funder: await context.ledger.inspectNamespace(context.operation.policy.funder),
    spend: await context.ledger.inspectNamespace(context.operation.policy.spend) });
  const unchanged = async (run: () => Promise<void>) => {
    const before = await snapshot();
    const beforeDiagnostic = JSON.parse(context.sql(postgresSnapshotDiagnosticSql));
    await run();
    const after = await snapshot();
    if (after.store !== before.store) {
      const afterDiagnostic = JSON.parse(context.sql(postgresSnapshotDiagnosticSql));
      console.error(JSON.stringify({ format: "synthetic-postgres-snapshot-diagnostic-v1",
        changedWitnesses: postgresSnapshotDiagnosticChanges(beforeDiagnostic, afterDiagnostic) }));
    }
    assert.deepEqual(after, before, "readiness preserves full history, caps, exposure and both nonce barriers");
    assert.equal(context.sql("select count(*) from keryx_storage.writer"), "0"); assert.equal(mutationCalls, 0);
  };
  try {
    await unchanged(async () => { const before = calls; assert.equal(await observe(request), null);
      assert.equal(calls, before, "missing original deposit refuses before Circle"); });
    await context.finalizeDeposit();
    assert.equal((await context.ledger.inspectReservation(context.operation.operationId, "deposit"))?.state, "finalized-success");
    await unchanged(async () => {
      const before = calls, token = await observe(request); assert(token); assert.equal(calls, before + 1);
      const evidence = await unsealVerifiedGatewayFundingReadiness(token, request);
      assert.equal(evidence.availableMicros, "100"); assert.equal(evidence.minimumAvailableMicros, "100");
      assert.equal(evidence.depositTransactionHash, (await context.ledger.inspectReservation(context.operation.operationId, "deposit"))?.prepared?.transactionHash);
      assert.notEqual(evidence.availableMicros, (BigInt(context.operation.initialAvailableMicros) + BigInt(context.operation.depositMicros)).toString(), "current balance is not attributed to this deposit");
      assert.throws(() => assertVerifiedGatewayFundingReadinessCurrent({} as VerifiedGatewayFundingReadiness, request));
      assert.throws(() => assertVerifiedGatewayFundingReadinessCurrent(JSON.parse(JSON.stringify(token)), request));
      await assert.rejects(() => unsealVerifiedGatewayFundingReadiness(token, { ...request, expectedBackendBindingDigest: "0".repeat(64) }));
    });
    for (const field of ["expectedBackendBindingDigest", "installedPolicyDigest"] as const) await unchanged(async () => {
      const before = calls; assert.equal(await observe({ ...request, [field]: "0".repeat(64) }), null); assert.equal(calls, before);
    });
    for (const role of ["anon", "authenticated"] as const) await unchanged(async () => {
      // The inspection executes against actual PG under the refused normal role;
      // the proxy routes it, without constructing any fictional terminal record.
      await context.refusedRoleInspection(role);
      let roleReads = 0;
      const restricted = new Proxy(readonlyLedger, { get(target, property) {
        if (property === "inspectOperation") return async () => { roleReads++; await context.refusedRoleInspection(role); throw new Error("Actual normal-role PG inspection refused"); };
        return Reflect.get(target, property);
      } });
      const before = calls; assert.equal(await observe({ ...request, ledger: restricted }), null); assert.equal(calls, before); assert.equal(roleReads, 1);
    });
    for (const selected of ["insufficient", "malformed", "outage", "redirect"] as const) await unchanged(async () => {
      mode = selected; const before = calls; assert.equal(await observe(request), null); assert.equal(calls, before + 1, "one native request; no retry or redirect");
    });
    mode = "available";
    await unchanged(async () => {
      const token = await observe(request); assert(token);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5100);
      assert.throws(() => assertVerifiedGatewayFundingReadinessCurrent(token, request), "elapsed TTL refuses with timer delivery blocked");
      await assert.rejects(() => unsealVerifiedGatewayFundingReadiness(token, request));
    });
    const token = await observe(request); assert(token); await context.changeNamespace();
    await unchanged(async () => {
      assertVerifiedGatewayFundingReadinessCurrent(token, request); const before = reservationReads;
      await assert.rejects(() => unsealVerifiedGatewayFundingReadiness(token, request), "actual changed namespace refuses stale evidence");
      assert.equal(reservationReads, before + 1, "changed snapshot was fully read from actual backend");
      assertVerifiedGatewayFundingReadinessCurrent(token, request);
    });
    console.log("Actual PG/PostgREST current readiness acceptance passed: original protected deposit, native Circle protocol, ACL, outage, TTL and unchanged history/caps/nonces.");
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
}
