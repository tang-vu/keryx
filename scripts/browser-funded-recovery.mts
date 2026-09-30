import { assertRuntimeStorageAuthority } from "../lib/db/runtime-storage-authority.ts";
/** Operator-controlled Arc testnet rehearsal. No browser UI/customer claim. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { privateKeyToAccount } from "viem/accounts";
import { browserRehearsalTransport } from "./browser-rehearsal-transport.ts";

const { values } = parseArgs({ options: {
  directory: { type: "string" }, source: { type: "string" },
  signer: { type: "string" }, "max-micro-usdc": { type: "string" },
  execute: { type: "boolean" }, inspect: { type: "boolean" },
  "confirm-local": { type: "boolean" },
}, strict: true });

async function main() {
  if (!values.directory || (!!values.execute === !!values.inspect))
    throw new Error("Specify a protected directory and exactly one of --execute/--inspect");
  if (values["confirm-local"] && !values.inspect) throw new Error("Local confirmation requires inspection");
  // No production adapter, arbitrary base URL, notification configuration or treasury fallback.
  if (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error("Supabase environment is forbidden in this isolated rehearsal");
  process.env.BASE_URL = "https://keryx.cc";
  process.env.KERYX_REGISTRY_READ_ADDRESS = "0x2e12Fa3256B21b9d8726933b5c4bfBDCc740e536";
  delete process.env.NEXT_PUBLIC_KERYX_REGISTRY_READ_ADDRESS;
  for (const key of Object.keys(process.env))
    if (/TELEGRAM|DISCORD|SLACK|WEBHOOK/.test(key)) delete process.env[key];
  const directory = path.resolve(values.directory);
  if (values.execute && fs.existsSync(directory)) throw new Error("Original rehearsal directory already exists");
  const { SqliteAdapter } = await import("../lib/db/sqlite-adapter.ts");
  const { readRuntimeStorageDeployment } = await import("../lib/db/runtime-storage-config.ts");
  const { searchCircleTransfer, checkPendingTransfer } = await import("../lib/gateway/x402-transfer-reconciliation.ts");
  const database = path.join(directory, "data", "keryx.sqlite");
  const metadataPath = path.join(directory, "recovery.json");
  if (values.inspect) {
    const original = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    // Existing original database only. No schema initialization or writer handle.
    const deployment = readRuntimeStorageDeployment();
    if (deployment.identity.authorityMode !== "testnet-real" || deployment.backend.kind !== "sqlite" || deployment.backend.databasePath !== database) throw new Error("Recovery storage identity mismatch");
    const db = new SqliteAdapter(database, { readOnly: !values["confirm-local"], expectedIdentity: deployment.identity });
    try {
      const rows = await db.listPayments(10);
      assert.equal(rows.length, 1);
      const row = rows[0];
      assert.equal(row.id, `x402:${original.nonce}`); assert.equal(row.authorizationId, original.nonce);
      assert.equal(row.payer.toLowerCase(), original.signer.toLowerCase());
      assert.equal(row.payee.toLowerCase(), original.payee.toLowerCase());
      assert.equal(row.amountUsdc, original.priceMicroUsdc / 1e6);
      assert.equal(row.sourceId, original.sourceId);
      assert.equal(row.network, "eip155:5042002");
      assert.equal((await db.getSessionGrant("rehearsal"))!.spent, row.amountUsdc);
      assert.equal((await db.getSessionGrant("rehearsal"))!.cap, original.ceilingMicroUsdc / 1e6);
      const journal = await db.getBrowserJournal("rehearsal", original.requestId);
      assert.equal(journal?.nonce, original.nonce); assert.equal(journal?.payment.id, row.id);
      assert.equal(journal?.phase, row.settled ? "settled" : "submission_attempted");
      const transfers = await searchCircleTransfer(row, AbortSignal.timeout(45_000));
      const proof = checkPendingTransfer({ ...row, settled: false, settlementStatus: "pending" }, transfers);
      assert.deepEqual(await db.listPayments(10), rows);
      const finality = proof.verdict === "settled" && ["completed", "confirmed"].includes(proof.transfer!.status);
      if (values["confirm-local"]) {
        assert.equal(proof.verdict, "settled");
        if (!row.settled) assert.ok(await db.settlePendingPayment(row.id!, row.authorizationId!, proof.transfer!.id));
        else assert.equal(row.txHash, proof.transfer!.id);
        const confirmed = await db.listPayments(10);
        assert.equal(confirmed.length, 1); assert.equal(confirmed[0].id, row.id);
        assert.equal(confirmed[0].authorizationId, row.authorizationId);
        assert.equal(confirmed[0].settled, true);
        assert.equal((await db.getSessionGrant("rehearsal"))!.spent, row.amountUsdc);
        assert.equal(await db.browserSignerConfirmedSpendMicro(row.payer), original.priceMicroUsdc);
      }
      console.log(JSON.stringify({ phase: values["confirm-local"] ? "isolated-local-confirmation" : "read-only-independent-circle-check", nonce: row.authorizationId,
        canonicalPaymentId: row.id, amountMicroUsdc: Math.round(row.amountUsdc * 1e6),
        retainedMicroUsdc: Math.round((await db.getSessionGrant("rehearsal"))!.spent * 1e6),
        confirmedMicroUsdc: await db.browserSignerConfirmedSpendMicro(row.payer),
        verdict: proof.verdict, transferId: proof.transfer?.id ?? null,
        circleTxHash: proof.transfer?.txHash ?? null,
        circleStatus: proof.transfer?.status ?? null, circleFinalStatus: finality,
        onchainFinalityVerified: false, locallySettled: !!values["confirm-local"] || row.settled,
        localWriterUsed: !!values["confirm-local"] }));
    } finally { db.close(); }
    return;
  }
  if (!values.source || !values.signer || !values["max-micro-usdc"])
    throw new Error("Execution requires trusted source JSON, pinned signer and explicit micro-USDC ceiling");
  const ceiling = Number(values["max-micro-usdc"]);
  assert.ok(Number.isSafeInteger(ceiling) && ceiling > 0 && ceiling <= 10_000);
  const account = privateKeyToAccount(process.env.KERYX_BUYER_PRIVATE_KEY as `0x${string}`);
  assert.equal(account.address.toLowerCase(), values.signer.toLowerCase());
  // Source JSON is an operator snapshot from the registry/DB, never synthesized from a challenge.
  const source = JSON.parse(fs.readFileSync(path.resolve(values.source), "utf8"));
  assert.match(source.id, /^[a-zA-Z0-9_-]+$/);
  assert.ok(source.onchainId, "A registered on-chain source is required");
  const price = Math.round(source.fetchPrice * 1e6);
  assert.ok(Number.isSafeInteger(price) && price > 0 && price <= ceiling);
  assert.equal(source.fetchPrice, price / 1e6);
  const { config } = await import("../lib/config.ts");
  assert.equal(config.networkId, "eip155:5042002");
  const { assertArcRpcChain } = await import("../lib/arc-rpc-attestation.ts");
  await assertArcRpcChain(config.rpcUrl);
  const { getGatewayAvailableAtomic } = await import("../lib/gateway/gateway-balance.ts");
  const availability = await getGatewayAvailableAtomic(account.address);
  assert.ok(availability !== null && availability >= BigInt(price));
  // Creation refuses an existing directory. Never overwrite or reset the original journal.
  fs.mkdirSync(directory, { mode: 0o700 });
  process.chdir(directory);
  const { getDb } = await import("../lib/db/index.ts");
  const db = await getDb() as InstanceType<typeof SqliteAdapter>;
  await db.upsertSessionGrant({ sessionId: "rehearsal", sessAddr: account.address,
    ownerAddr: account.address, cap: ceiling / 1e6, expiry: Date.now() + 10 * 86400000,
    txHash: "operator-controlled-testnet-rehearsal-not-a-funding-transaction", grantEpoch: "rehearsal" });
  await db.activateBrowserJournal();
  assert.equal((await db.listPayments(10)).length, 0);
  assert.equal((await db.getSessionGrant("rehearsal"))!.spent, 0);
  const { sourceFetchTerms } = await import("../lib/registry/source-fetch-payto.ts");
  const terms = await sourceFetchTerms(source, { refresh: true });
  assert.equal(terms.authority, "onchain"); assert.equal(terms.stale, false); assert.equal(terms.active, true);
  assert.equal(terms.payTo.toLowerCase(), source.walletAddress.toLowerCase());
  assert.equal(terms.listPriceUsdc, source.fetchPrice);
  const { BrowserCoSignGateway } = await import("../lib/payments/browser-cosign-gateway.ts");
  const { PaymentPendingError } = await import("../lib/payments/payment-state.ts");
  const originalFetch = globalThis.fetch;
  let nonce = "", requestId = "";
  const endpoint = `https://keryx.cc/api/source/${source.id}`;
  const transport = browserRehearsalTransport(endpoint, originalFetch);
  globalThis.fetch = transport.fetchImpl;
  try {
    const gateway = new BrowserCoSignGateway("rehearsal", account.address,
      async (request, requirements, kind, sourceId, _context, admittedNonce) => {
        assert.equal(kind, "fetch"); assert.equal(sourceId, source.id);
        assert.equal(requirements.amount, String(price));
        assert.equal(requirements.payTo.toLowerCase(), terms.payTo.toLowerCase());
        assert.equal(requirements.network, "eip155:5042002");
        assert.equal(nonce, ""); nonce = admittedNonce; requestId = request;
        await assertArcRpcChain(config.rpcUrl);
        const balance = await getGatewayAvailableAtomic(account.address);
        assert.ok(balance !== null && balance >= BigInt(price));
        fs.writeFileSync(metadataPath, JSON.stringify({ nonce, requestId, signer: account.address,
          payee: terms.payTo, sourceId: source.id, priceMicroUsdc: price, ceilingMicroUsdc: ceiling }), { flag: "wx", mode: 0o600 });
        const now = Math.floor(Date.now() / 1000);
        const authorization = { from: account.address, to: requirements.payTo,
          value: requirements.amount, validAfter: String(now - 600),
          validBefore: String(now + requirements.maxTimeoutSeconds), nonce };
        const signature = await account.signTypedData({ domain: { name: "GatewayWalletBatched", version: "1",
          chainId: 5042002, verifyingContract: requirements.extra.verifyingContract as `0x${string}` },
          primaryType: "TransferWithAuthorization", types: { TransferWithAuthorization: [
            { name: "from", type: "address" }, { name: "to", type: "address" },
            { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
          ] }, message: { ...authorization, to: authorization.to as `0x${string}`,
            value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter),
            validBefore: BigInt(authorization.validBefore), nonce: nonce as `0x${string}` } });
        return Buffer.from(JSON.stringify({ authorization, signature })).toString("base64");
      }, AbortSignal.timeout(60_000), "rehearsal", () => { assertRuntimeStorageAuthority(db); });
    await assert.rejects(gateway.payFetch({ source, queryId: "operator-rehearsal" }), PaymentPendingError);
    assert.deepEqual(transport.summary(), { paidCalls: 1, responseObserved: true });
    const rows = await db.listPayments(10); assert.equal(rows.length, 1);
    assert.equal(rows[0].authorizationId, nonce); assert.equal(rows[0].id, `x402:${nonce}`);
    assert.equal(rows[0].authorizationPhase, "submission_attempted"); assert.equal(rows[0].settled, false);
    const journal = await db.getBrowserJournal("rehearsal", requestId);
    assert.equal(journal?.nonce, nonce); assert.equal(journal?.phase, "submission_attempted");
    assert.equal(journal?.payment.id, rows[0].id);
    assert.equal((await db.getSessionGrant("rehearsal"))?.spent, price / 1e6);
    assert.equal(await db.browserSignerConfirmedSpendMicro(account.address), 0);
    console.log(JSON.stringify({ phase: "original-process-before-exit", nonce,
      canonicalPaymentId: rows[0].id, paidHttpCalls: transport.summary().paidCalls, retainedMicroUsdc: price,
      locallySettled: false, recovery: "Run --inspect in a new process; never execute again for this directory" }));
  } finally { globalThis.fetch = originalFetch; db.close(); }
}

main().catch(() => { console.error("Rehearsal stopped. Preserve original journal; no retry. Private details omitted."); process.exitCode = 1; });
