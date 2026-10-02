import { afterEach, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { ARC_MAINNET_PROFILE, ARC_TESTNET_PROFILE } from "../arc-network-profile";
import { canonicalJson } from "../canonical-json";
import { STORAGE_MAINNET_PROFILE_DIGEST, validateStorageIdentity, type StorageIdentity } from "./storage-identity";
import { createSqliteStorage, enrollSqliteStorage } from "./storage-identity-provision";
import type { BrowserJournalAdmission } from "./browser-authorization-journal";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
async function fixture() {
  vi.resetModules();
  const folder = mkdtempSync(join(tmpdir(), "keryx-mainnet-storage-")), file = join(folder, "fresh.sqlite");
  cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
  const identity: StorageIdentity = { format: "keryx-mainnet-storage-identity-v1", authorityMode: "mainnet-real",
    network: ARC_MAINNET_PROFILE.networkId, profileDigest: STORAGE_MAINNET_PROFILE_DIGEST,
    deploymentId: randomUUID(), storageId: randomUUID(), enrollmentId: randomUUID(), enrolledAt: new Date().toISOString(),
    provenanceDigest: "11".repeat(32) };
  await createSqliteStorage(file, identity);
  const manifestPath = join(folder, "storage.json");
  writeFileSync(manifestPath, canonicalJson({ format: "keryx-storage-deployment-v1", identity,
    backend: { kind: "sqlite", databasePath: file } }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", manifestPath); vi.stubEnv("KERYX_SQLITE_PATH", file);
  vi.stubEnv("KERYX_FORCE_OFFLINE", "0"); vi.stubEnv("CONTENT_MASTER_KEY", randomBytes(32).toString("hex"));
  vi.stubEnv("KERYX_NETWORK", "arc"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
  vi.stubEnv("BASE_URL", "https://keryx.cc");
  vi.stubEnv("KERYX_REGISTRY_ADDRESS", `0x${"55".repeat(20)}`); vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS", `0x${"55".repeat(20)}`);
  const adapter = await (await import("./index")).getDb();
  cleanup.push(() => { if ("close" in adapter) (adapter.close as () => void)(); });
  return { adapter, file, identity, manifestPath };
}
it("uses a fresh native mainnet namespace and atomically retains its own nonce/cap history", async () => {
  const { adapter, file } = await fixture();
  await adapter.activateBrowserJournal();
  const owner = "0x1111111111111111111111111111111111111111", signer = "0x2222222222222222222222222222222222222222";
  const payee = "0x3333333333333333333333333333333333333333", grantEpoch = randomUUID();
  await adapter.upsertSessionGrant({ sessionId: owner, ownerAddr: owner, sessAddr: signer, grantEpoch,
    cap: 0.001, expiry: Date.now() + 60_000, txHash: "synthetic-test-no-funds" });
  const input: BrowserJournalAdmission = { sessionId: owner, signer, grantEpoch, requestId: randomUUID(), queryId: randomUUID(),
    sourceId: "synthetic-source", offerId: null, kind: "fetch", payee, amountMicroUsdc: 1000,
    network: ARC_MAINNET_PROFILE.networkId, token: ARC_MAINNET_PROFILE.usdcAddress, gatewayContract: ARC_MAINNET_PROFILE.gatewayWallet,
    requirements: { scheme: "exact", network: ARC_MAINNET_PROFILE.networkId, asset: ARC_MAINNET_PROFILE.usdcAddress,
      payTo: payee, amount: "1000", maxTimeoutSeconds: 604900, extra: { name: "GatewayWalletBatched", version: "1",
        verifyingContract: ARC_MAINNET_PROFILE.gatewayWallet } },
    payment: { kind: "fetch", queryId: "", sourceId: "synthetic-source", sourceName: "Synthetic source",
      payer: signer, payee, amountUsdc: 0.001, network: ARC_MAINNET_PROFILE.networkId, grantEpoch } };
  input.payment.queryId = input.queryId;
  const admitted = await adapter.admitBrowserJournal(input);
  expect(admitted.status).toBe("admitted");
  await expect(adapter.admitBrowserJournal({ ...input, requestId: randomUUID(), network: ARC_TESTNET_PROFILE.networkId,
    gatewayContract: ARC_TESTNET_PROFILE.gatewayWallet })).rejects.toThrow();
  expect((await adapter.admitBrowserJournal({ ...input, requestId: randomUUID() })).status).toBe("grant_or_cap_refused");
  expect((await adapter.getSessionGrant(owner))!.spent).toBe(0.001);
  const native = new DatabaseSync(file);
  try {
    expect(native.prepare("SELECT count(*) AS n FROM browser_authorization_intents").get()?.n).toBe(1);
    expect(native.prepare("SELECT network FROM browser_authorization_intents").get()?.network).toBe(ARC_MAINNET_PROFILE.networkId);
    expect(native.prepare("SELECT spent_micro FROM browser_signer_capacity WHERE signer=?").get(signer)?.spent_micro).toBe(1000);
  } finally { native.close(); }
}, 30000);

it("recovers expired owner custody through normal withdrawal handlers while preserving unknown holds and one original burn", async () => {
  const { adapter } = await fixture();
  const { privateKeyToAccount } = await import("viem/accounts"), { NextRequest, } = await import("next/server");
  const { pad, toHex, parseTransaction, keccak256, encodeAbiParameters, encodeEventTopics, encodeFunctionData } = await import("viem");
  const owner = privateKeyToAccount(`0x${"11".repeat(32)}`), session = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const wallet = owner.address.toLowerCase(), signer = session.address.toLowerCase(), profile = (await import("../config")).config.profile;
  let authenticatedWallet = wallet, transferCalls = 0, availableBalance = "1", mintTransaction: Record<string, unknown> | null = null,
    mintReceipt: Record<string, unknown> | null = null, injectedDebit = false;
  const observedSeconds = Math.floor(Date.now() / 1000), mintHash = `0x${"ab".repeat(32)}`, finalHash = `0x${"cd".repeat(32)}`;
  let authenticationDb = adapter;
  vi.doMock("../account-sessions", () => ({ accountSessionContext: async () => ({ db: authenticationDb, wallet: authenticatedWallet }) }));
  cleanup.push(() => vi.doUnmock("../account-sessions"));
  vi.stubEnv("KERYX_WITHDRAWAL_MAX_FEE_MICROS", "1000"); vi.stubEnv("KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS", "100");
  vi.stubEnv("KERYX_WITHDRAWAL_MAX_PROCESSING_LAG_BLOCKS", "10");
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    const target = String(url);
    if (target.endsWith("/v1/balances")) return Response.json({ token: "USDC", balances: [{ depositor: signer, domain: 26, balance: availableBalance }] });
    if (target.endsWith("/v1/info")) return Response.json({ domains: [{ domain: 26, chain: "Arc", network: "Mainnet", processedHeight: "10000",
      burnIntentExpirationHeight: "10010", walletContract: { address: profile.gatewayWallet, supportedTokens: ["USDC"] },
      minterContract: { address: profile.gatewayMinter, supportedTokens: ["USDC"] } }] });
    if (target.endsWith("/v1/estimate")) return Response.json([{ burnIntent: { spec: JSON.parse(String(init.body))[0].spec, maxBlockHeight: "10010", maxFee: "1000" } }]);
    if (target.endsWith("/v1/transfer")) { transferCalls++; throw new Error("Synthetic lost response; private vendor detail"); }
    if (target === profile.rpcUrl || target === `${profile.rpcUrl}/`) {
      const rpc = JSON.parse(String(init.body));
      const tag = rpc.params?.[0];
      const result = rpc.method === "eth_chainId" ? toHex(profile.chainId) :
        rpc.method === "eth_getTransactionByHash" ? mintTransaction : rpc.method === "eth_getTransactionReceipt" ? mintReceipt :
        rpc.method === "eth_getCode" ? "0x60006000" : rpc.method === "eth_call" ? (rpc.params[0].data.length === 74 ? `0x${"0".repeat(63)}1` : "0x") :
        rpc.method === "eth_getBlockByNumber" ? { number: toHex(mintTransaction ? (tag === "0x2711" ? 10001 : 10002) : 10000),
          timestamp: toHex(observedSeconds), hash: mintTransaction ? (tag === "0x2711" ? mintHash : finalHash) : `0x${"66".repeat(32)}`,
          transactions: mintTransaction && tag === "0x2711" ? [mintTransaction.hash] : [] } : undefined;
      if (result === undefined) throw new Error("Unexpected synthetic RPC");
      return Response.json({ jsonrpc: "2.0", id: rpc.id, result });
    }
    throw new Error("Unexpected synthetic transport");
  }));
  const grants = await import("../payments/mainnet-session-grants"), messages = await import("../payments/session-grant-consent");
  const { consent } = await grants.issueMainnetSessionGrant(adapter, wallet, { sessAddr: signer, budgetMicros: "1000000" });
  await grants.consumeMainnetSessionGrant(adapter, wallet, { consent,
    signature: await owner.signMessage({ message: messages.createSessionGrantConsentMessage(consent, profile) }),
    sessionSignature: await session.signMessage({ message: messages.createSessionGrantSignerProofMessage(consent, profile) }) });
  const payee = `0x${"33".repeat(20)}`, queryId = randomUUID(), reqId = randomUUID();
  const paymentInput: BrowserJournalAdmission = { sessionId: wallet, requestId: reqId, queryId, grantEpoch: consent.grantEpoch, signer,
    network: profile.networkId, token: profile.usdcAddress, gatewayContract: profile.gatewayWallet, sourceId: "synthetic-source",
    offerId: null, kind: "fetch", payee, amountMicroUsdc: 100000,
    requirements: { scheme: "exact", network: profile.networkId, asset: profile.usdcAddress, payTo: payee, amount: "100000",
      maxTimeoutSeconds: 604900, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: profile.gatewayWallet } },
    payment: { queryId, sourceId: "synthetic-source", sourceName: "Source", kind: "fetch", payer: signer, payee,
      amountUsdc: 0.1, network: profile.networkId, grantEpoch: consent.grantEpoch } };
  const admitted = await adapter.admitBrowserJournal(paymentInput); expect(admitted.status).toBe("admitted");
  await adapter.exposeBrowserJournal(wallet, reqId);
  const other = await (await import("./enrolled-sqlite-adapter")).createEnrolledSqliteAdapter(); cleanup.push(() => other.close());
  const prepare = await import("../../app/api/session/withdraw/prepare/route"), submit = await import("../../app/api/session/withdraw/submit/route");
  const status = await import("../../app/api/session/withdraw/[requestId]/route"), history = await import("../../app/api/session/withdraw/payments/route");
  const request = (path: string, body: unknown) => new NextRequest(`https://keryx.cc${path}`, { method: "POST",
    headers: { Origin: "https://keryx.cc", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  // Unknown exposed liabilities cannot become withdrawal capacity after revoke.
  expect((await prepare.POST(request("/api/session/withdraw/prepare", { sessAddr: signer, grantEpoch: consent.grantEpoch, amountMicros: "900000" }))).status).toBe(503);
  // Quote and final service read complete first. Another native connection then
  // admits and settles a debit before reserve's BEGIN IMMEDIATE: held is unchanged,
  // but the captured confirmed counter must refuse the stale available balance.
  authenticationDb = new Proxy(Object.assign(Object.create(null), adapter) as typeof adapter, { get(target, key) {
    if (key !== "reserveSessionWithdrawal") return Reflect.get(target, key);
    return async (packet: Parameters<typeof adapter.reserveSessionWithdrawal>[0]) => {
      injectedDebit = true;
      const extra = await other.admitBrowserJournal({ ...paymentInput, requestId: randomUUID(), amountMicroUsdc: 1000,
        requirements: { ...paymentInput.requirements, amount: "1000" }, payment: { ...paymentInput.payment, amountUsdc: 0.001 } });
      if (extra.status !== "admitted") throw new Error("Synthetic debit refused");
      await other.exposeBrowserJournal(wallet, extra.journal.requestId);
      expect(await other.settlePendingPayment(extra.journal.payment.id!, extra.journal.nonce, "synthetic-confirmed-concurrent-debit")).toBe(true);
      return target.reserveSessionWithdrawal(packet);
    };
  } });
  expect((await prepare.POST(request("/api/session/withdraw/prepare", { sessAddr: signer, grantEpoch: consent.grantEpoch, amountMicros: "800000" }))).status).toBe(503);
  expect(injectedDebit).toBe(true); expect(await adapter.pendingSessionWithdrawal(wallet, signer)).toBeNull();
  expect((await adapter.getSessionGrant(wallet))?.expiry).toBeGreaterThan(Date.now());
  authenticationDb = adapter; availableBalance = "0.999";
  await adapter.revokeSessionGrant(wallet, consent.grantEpoch, signer);
  const prepared = await prepare.POST(request("/api/session/withdraw/prepare", { sessAddr: signer, grantEpoch: consent.grantEpoch, amountMicros: "800000" }));
  expect(prepared.status).toBe(200); const p = await prepared.json();
  expect(p).toMatchObject({ ownerAddr: wallet, sessAddr: signer, network: profile.networkId,
    balance: { heldPaymentMicroUsdc: "100000", maxFeeMicroUsdc: "1000" },
    burnIntent: { spec: { destinationRecipient: pad(wallet as `0x${string}`, { size: 32 }), value: "800000" } } });
  // A concurrent connection cannot revive payment permission or replace the burn.
  const concurrent = await Promise.allSettled([
    other.upsertSessionGrant({ sessionId: wallet, ownerAddr: wallet, sessAddr: signer, grantEpoch: randomUUID(), cap: 2,
      expiry: Date.now() + 60000, txHash: "synthetic-no-funds" }),
    adapter.reserveSessionWithdrawal(p),
    other.reserveSessionWithdrawal({ ...p, requestId: `0x${"aa".repeat(32)}` }),
  ]);
  expect(concurrent.map(result => result.status)).toEqual(["rejected", "fulfilled", "rejected"]);
  const repeat = await prepare.POST(request("/api/session/withdraw/prepare", { sessAddr: signer, grantEpoch: consent.grantEpoch, amountMicros: "700000" }));
  expect(await repeat.json()).toEqual(p);
  const signature = await session.signTypedData((await import("../gateway/withdraw-protocol")).withdrawTypedData(p.burnIntent));
  const body = { requestId: p.requestId, signature };
  const sent = await submit.POST(request("/api/session/withdraw/submit", body)); expect(sent.status).toBe(200);
  expect(await sent.json()).toMatchObject({ preparation: p, progress: { status: "awaiting-transfer-evidence", retryAuthorized: false }, mint: null, completion: null });
  expect((await submit.POST(request("/api/session/withdraw/submit", body))).status).toBe(200); expect(transferCalls).toBe(1);
  expect((await adapter.getCreatorWithdrawal(p.requestId, signer))?.request.burnIntent).toEqual(p.burnIntent);
  const liabilities = await history.GET(new NextRequest(`https://keryx.cc/api/session/withdraw/payments?sessAddr=${signer}&grantEpoch=${consent.grantEpoch}`));
  const historyBody = await liabilities.json(); expect(historyBody).toMatchObject({ nextCursor: null, retryAuthorized: false });
  expect(historyBody.payments.map((payment: {phase:string}) => payment.phase).sort()).toEqual(["exposed", "settled"]);
  expect((await adapter.sessionWithdrawalAccounting(signer)).heldPaymentMicroUsdc).toBe("100000");
  authenticatedWallet = payee;
  expect((await status.GET(new NextRequest(`https://keryx.cc/api/session/withdraw/${p.requestId}`), { params: Promise.resolve({ requestId: p.requestId }) })).status).toBe(404);
  expect((await submit.POST(request("/api/session/withdraw/submit", body))).status).toBe(404);
  authenticatedWallet = wallet;
  const record = (await adapter.getCreatorWithdrawal(p.requestId, signer))!, claim = (await adapter.getCreatorWithdrawalTransferClaim(p.requestId, signer))!;
  const spec = record.request.burnIntent.spec, attester = privateKeyToAccount(`0x${"44".repeat(32)}`);
  const encodedSpec = "ca85def7000000010000001a0000001a" + [spec.sourceContract, spec.destinationContract, spec.sourceToken,
    spec.destinationToken, spec.sourceDepositor, spec.destinationRecipient, spec.sourceSigner, spec.destinationCaller].map(v => v.slice(2)).join("") +
    BigInt(spec.value).toString(16).padStart(64, "0") + spec.salt.slice(2) + "00000000";
  const attestation = `0xff6fb334${BigInt(10020).toString(16).padStart(64, "0")}00000154${encodedSpec}` as `0x${string}`;
  const vendorResponse = { transferId: randomUUID(), attestation, expirationBlock: "10020",
    signature: await attester.signMessage({ message: { raw: keccak256(attestation) } }) };
  // Recovery obtains the original matched attestation, with no second transfer.
  await adapter.saveCreatorWithdrawalAttestation(p.requestId, signer, claim.claimId, vendorResponse);
  const { WITHDRAWAL_MINTER_ABI } = await import("../gateway/withdrawal-mint-observation");
  const data = encodeFunctionData({ abi: WITHDRAWAL_MINTER_ABI, functionName: "gatewayMint", args: [attestation, vendorResponse.signature] });
  const raw = await owner.signTransaction({ type: "eip1559", chainId: profile.chainId, nonce: 0, gas: BigInt(300000),
    maxFeePerGas: BigInt(2000000000), maxPriorityFeePerGas: BigInt(1000000000), to: p.policy.gatewayMinter, value: BigInt(0), data });
  const t = parseTransaction(raw), txHash = keccak256(raw);
  mintTransaction = { type: "0x2", chainId: toHex(profile.chainId), nonce: "0x0", gas: toHex(300000), maxFeePerGas: toHex(2000000000),
    maxPriorityFeePerGas: toHex(1000000000), to: p.policy.gatewayMinter, from: wallet, value: "0x0", input: data,
    accessList: [], r: t.r, s: t.s, yParity: toHex(t.yParity!), hash: txHash, blockHash: mintHash, blockNumber: toHex(10001), transactionIndex: "0x0" };
  const { WITHDRAWAL_MINT_EVENT } = await import("../gateway/withdrawal-mint-receipt");
  const specHash = (await import("../gateway/withdrawal-attestation")).withdrawalTransferSpecHash(record);
  mintReceipt = { transactionHash: txHash, blockHash: mintHash, blockNumber: toHex(10001), transactionIndex: "0x0", from: wallet,
    to: p.policy.gatewayMinter, status: "0x1", type: "0x2", gasUsed: toHex(150000), cumulativeGasUsed: toHex(150000),
    effectiveGasPrice: toHex(1500000000), logs: [{ transactionHash: txHash, blockHash: mintHash, blockNumber: toHex(10001),
      transactionIndex: "0x0", logIndex: "0x0", address: p.policy.gatewayMinter, removed: false,
      topics: encodeEventTopics({ abi: WITHDRAWAL_MINT_EVENT, eventName: "AttestationUsed", args: { token: p.policy.asset, recipient: wallet as `0x${string}`, transferSpecHash: specHash } }),
      data: encodeAbiParameters([{ type: "uint32" }, { type: "bytes32" }, { type: "bytes32" }, { type: "uint256" }], [26, spec.sourceDepositor, spec.sourceSigner, BigInt(spec.value)]) }] };
  const final = await import("../../app/api/session/withdraw/complete/route");
  expect((await final.POST(request("/api/session/withdraw/complete", { requestId: p.requestId, transactionHash: `0x${"ff".repeat(32)}` }))).status).toBe(503);
  expect(await adapter.getSessionWithdrawalCompletion(p.requestId, wallet)).toBeNull();
  const completed = await final.POST(request("/api/session/withdraw/complete", { requestId: p.requestId, transactionHash: txHash }));
  expect(completed.status).toBe(200);
  expect(await completed.json()).toMatchObject({ progress: { status: "mint-finalized-observed", chainFinalityVerified: true },
    completion: { requestId: p.requestId, serializedTransaction: raw, observation: { transactionHash: txHash, chainId: profile.chainId } } });
  expect(await adapter.pendingSessionWithdrawal(wallet, signer)).toBeNull();
  expect((await adapter.sessionWithdrawalAccounting(signer)).heldPaymentMicroUsdc).toBe("100000");
  availableBalance = "0.198";
  const renewed = await grants.issueMainnetSessionGrant(adapter, wallet, { sessAddr: signer, budgetMicros: "198000" });
  await grants.consumeMainnetSessionGrant(adapter, wallet, { consent: renewed.consent,
    signature: await owner.signMessage({ message: messages.createSessionGrantConsentMessage(renewed.consent, profile) }),
    sessionSignature: await session.signMessage({ message: messages.createSessionGrantSignerProofMessage(renewed.consent, profile) }) });
  expect((await adapter.getSessionGrant(wallet))?.spent).toBe(0.101);
  expect((await other.admitBrowserJournal({ ...paymentInput, requestId: randomUUID(), grantEpoch: renewed.consent.grantEpoch,
    amountMicroUsdc: 1000, requirements: { ...paymentInput.requirements, amount: "1000" }, payment: { ...paymentInput.payment,
      grantEpoch: renewed.consent.grantEpoch, amountUsdc: 0.001 } })).status).toBe("admitted");
  expect(transferCalls).toBe(1);
}, 60000);
it("consumes an exact owner-signed funded consent once across two native connections and retains proof after expiry", async () => {
  const { adapter, file } = await fixture();
  const { config } = await import("../config");
  const { privateKeyToAccount } = await import("viem/accounts");
  const owner = privateKeyToAccount(`0x${"11".repeat(32)}`), session = privateKeyToAccount(`0x${"22".repeat(32)}`), signer = session.address.toLowerCase();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe("https://gateway-api.circle.com/v1/balances");
    expect(JSON.parse(String(init.body))).toEqual({ token: "USDC", sources: [{ depositor: signer, domain: 26 }] });
    return Response.json({ token: "USDC", balances: [{ depositor: signer, domain: 26, balance: "1.000000", pending: "0" }] });
  }));
  const service = await import("../payments/mainnet-session-grants"), { createSessionGrantConsentMessage, createSessionGrantSignerProofMessage } = await import("../payments/session-grant-consent");
  const { consent } = await service.issueMainnetSessionGrant(adapter, owner.address, { sessAddr: signer, budgetMicros: "500000" });
  const signature = await owner.signMessage({ message: createSessionGrantConsentMessage(consent, config.profile) });
  const sessionSignature = await session.signMessage({ message: createSessionGrantSignerProofMessage(consent, config.profile) });
  const second = await (await import("./enrolled-sqlite-adapter")).createEnrolledSqliteAdapter();
  cleanup.push(() => second.close());
  const attacker = privateKeyToAccount(`0x${"44".repeat(32)}`);
  const { consent: foreign } = await service.issueMainnetSessionGrant(adapter, attacker.address, { sessAddr: signer, budgetMicros: "500000" });
  const attackerSignature = await attacker.signMessage({ message: createSessionGrantConsentMessage(foreign, config.profile) });
  const fakePossession = await attacker.signMessage({ message: createSessionGrantSignerProofMessage(foreign, config.profile) });
  await expect(service.consumeMainnetSessionGrant(adapter, attacker.address, { consent: foreign, signature: attackerSignature, sessionSignature: fakePossession }))
    .rejects.toThrow("Session signer possession proof refused");
  expect(await adapter.getSessionGrant(attacker.address.toLowerCase())).toBeNull();
  await expect(service.consumeMainnetSessionGrant(adapter, attacker.address, { consent: foreign, signature: attackerSignature, sessionSignature }))
    .rejects.toThrow("Session signer possession proof refused");
  await service.consumeMainnetSessionGrant(adapter, owner.address, { consent, signature, sessionSignature });
  await expect(service.consumeMainnetSessionGrant(second, owner.address, { consent, signature, sessionSignature })).rejects.toThrow();
  const grant = (await second.getSessionGrant(owner.address.toLowerCase()))!;
  expect(grant.grantEpoch).toBe(consent.grantEpoch); expect(grant.cap).toBe(0.5);
  await expect(service.consumeMainnetSessionGrant(second, signer, { consent, signature, sessionSignature })).rejects.toThrow();
  await expect(service.consumeMainnetSessionGrant(second, owner.address, { consent: { ...consent, capMicroUsdc: "999999" }, signature, sessionSignature })).rejects.toThrow();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Number(consent.expirySeconds) * 1000 + 1);
  await second.deleteExpiredSessionGrants(Date.now());
  expect(await second.getSessionGrantConsent(owner.address.toLowerCase(), consent.grantEpoch)).toEqual({ consent, ownerSignature: signature, sessionSignature });
  const native = new DatabaseSync(file);
  try {
    expect(() => native.prepare("DELETE FROM session_grant_consents").run()).toThrow();
    expect(native.prepare("SELECT count(*) AS n FROM browser_retained_grants").get()?.n).toBe(1);
  } finally { native.close(); }
}, 30000);
it("refuses adopting, reusing or relabelling mainnet storage as testnet", async () => {
  const { file, identity } = await fixture();
  await expect(createSqliteStorage(file, identity)).rejects.toThrow();
  await expect(enrollSqliteStorage(file, identity, {} as never)).rejects.toThrow();
  for (const mutation of [{ format: "keryx-storage-identity-v1" }, { authorityMode: "testnet-real" },
    { network: ARC_TESTNET_PROFILE.networkId }, { profileDigest: "22".repeat(32) }])
    expect(() => validateStorageIdentity({ ...identity, ...mutation })).toThrow();
}, 30000);
it("refuses mainnet without a sealed manifest before creating a legacy database", async () => {
  vi.resetModules();
  const folder = mkdtempSync(join(tmpdir(), "keryx-mainnet-no-fallback-")), file = join(folder, "legacy.sqlite");
  cleanup.push(() => rmSync(folder, { recursive: true, force: true }));
  vi.stubEnv("KERYX_STORAGE_MANIFEST", undefined); vi.stubEnv("KERYX_SQLITE_PATH", file);
  vi.stubEnv("KERYX_NETWORK", "arc"); vi.stubEnv("NEXT_PUBLIC_KERYX_NETWORK", "arc");
  vi.stubEnv("KERYX_REGISTRY_ADDRESS", `0x${"55".repeat(20)}`); vi.stubEnv("NEXT_PUBLIC_KERYX_REGISTRY_ADDRESS", `0x${"55".repeat(20)}`);
  const { getDb } = await import("./index");
  await expect(getDb()).rejects.toThrow("Storage deployment configuration unavailable");
  expect(existsSync(file)).toBe(false);
});
it("closes the initialized application facade when its pinned manifest changes", async () => {
  const { adapter, manifestPath, identity, file } = await fixture();
  writeFileSync(manifestPath, canonicalJson({ format: "keryx-storage-deployment-v1",
    identity: { ...identity, storageId: randomUUID() }, backend: { kind: "sqlite", databasePath: file } }));
  await expect(Promise.resolve().then(() => adapter.listSources())).rejects.toThrow();
  const native = new DatabaseSync(file);
  try { expect(native.prepare("SELECT count(*) AS n FROM sources").get()?.n).toBe(0); } finally { native.close(); }
}, 30000);
it("refuses forcing sealed real mainnet storage offline before application writes", async () => {
  const { adapter, file } = await fixture();
  vi.stubEnv("KERYX_FORCE_OFFLINE", "1");
  const { readRuntimeStorageDeployment } = await import("./runtime-storage-config");
  expect(() => readRuntimeStorageDeployment()).toThrow("Storage deployment configuration unavailable");
  await expect(Promise.resolve().then(() => adapter.listSources())).rejects.toThrow();
  const native = new DatabaseSync(file);
  try { expect(native.prepare("SELECT count(*) AS n FROM sources").get()?.n).toBe(0); } finally { native.close(); }
}, 30000);
it("serves the normal owner consent and exact live admitted item challenge through actual handlers", async () => {
  const { adapter } = await fixture();
  const { privateKeyToAccount } = await import("viem/accounts"), { NextRequest } = await import("next/server");
  const owner = privateKeyToAccount(`0x${"11".repeat(32)}`), session = privateKeyToAccount(`0x${"22".repeat(32)}`);
  const wallet = owner.address.toLowerCase(), signer = session.address.toLowerCase();
  let authenticatedWallet = wallet;
  vi.doMock("../account-sessions", () => ({ accountSessionContext: async () => ({ db: adapter, wallet: authenticatedWallet }) }));
  vi.doMock("../auth", () => ({ getSession: async () => ({ address: wallet }) }));
  cleanup.push(() => { vi.doUnmock("../account-sessions"); vi.doUnmock("../auth"); });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ token: "USDC", balances: [{ depositor: signer, domain: 26, balance: "1" }] })));
  const challengeRoute = await import("../../app/api/session/grant/challenge/route"), grantRoute = await import("../../app/api/session/grant/route");
  const creditRoute = await import("../../app/api/session/credit/route");
  const credit = (after?: string, grantEpoch?: string) => creditRoute.GET(new NextRequest(`https://keryx.cc/api/session/credit?address=${signer}&accounting=original-v1${after ? `&after=${encodeURIComponent(after)}` : ""}${grantEpoch ? `&grantEpoch=${grantEpoch}` : ""}`));
  const freshCredit = await (await credit()).json();
  expect(freshCredit).toMatchObject({ status: "known", available: "1000000", hasAuthorityHistory: false,
    confirmedSpentMicroUsdc: "0", retainedSpentMicroUsdc: "0", postBaselineConfirmedDebitMicroUsdc: "0" });
  const request = (path: string, body: unknown, origin = "https://keryx.cc") => new NextRequest(`https://keryx.cc${path}`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  expect((await challengeRoute.POST(request("/api/session/grant/challenge", { sessAddr: signer, budgetMicros: "500000" }, "https://foreign.example"))).status).toBe(403);
  const issued = await challengeRoute.POST(request("/api/session/grant/challenge", { sessAddr: signer, budgetMicros: "500000" }));
  expect(issued.status).toBe(200);
  const { consent } = await issued.json(), { config } = await import("../config");
  const messages = await import("../payments/session-grant-consent");
  const signature = await owner.signMessage({ message: messages.createSessionGrantConsentMessage(consent, config.profile) });
  const sessionSignature = await session.signMessage({ message: messages.createSessionGrantSignerProofMessage(consent, config.profile) });
  const granted = await grantRoute.POST(request("/api/session/grant", { consent, signature, sessionSignature }));
  expect(granted.status).toBe(200);
  expect(await granted.json()).toMatchObject({ cap: 0.5, capMicroUsdc: "500000", spentMicroUsdc: "0" });
  expect((await grantRoute.POST(request("/api/session/grant", { consent, signature, sessionSignature }))).status).toBe(409);
  const status = await (await grantRoute.GET(new NextRequest("https://keryx.cc/api/session/grant"))).json();
  expect(status).toMatchObject({ active: true, sessionId: wallet, ownerAddr: wallet, sessAddr: signer, network: "eip155:5042",
    origin: "https://keryx.cc", capMicroUsdc: "500000", consent, ownerSignature: signature, sessionSignature });
  const reqId = randomUUID(), queryId = randomUUID(), payee = `0x${"33".repeat(20)}`;
  const item = { itemId: "one", itemTitle: "Exact encrypted evidence", itemUrl: "https://source.example/item",
    contentVersion: `sha256:${"44".repeat(32)}`, contentReceipt: { deliveryKind: "full_text" as const, storageMode: "db_encrypted" as const,
      plaintextBytes: 42, bodyHash: `0x${"55".repeat(32)}` } };
  const requirements = { scheme: "exact", network: config.profile.networkId, asset: config.profile.usdcAddress,
    payTo: payee, amount: "500000", maxTimeoutSeconds: 604900, extra: { name: "GatewayWalletBatched", version: "1", verifyingContract: config.profile.gatewayWallet } };
  const admission = await adapter.admitBrowserJournal({ sessionId: wallet, requestId: reqId, queryId, grantEpoch: consent.grantEpoch,
    signer, network: config.profile.networkId, token: config.profile.usdcAddress, gatewayContract: config.profile.gatewayWallet,
    sourceId: "synthetic-source", offerId: null, kind: "fetch", payee, amountMicroUsdc: 500000, requirements, paymentContext: { item },
    payment: { queryId, sourceId: "synthetic-source", sourceName: "Source", kind: "fetch", payer: signer, payee,
      amountUsdc: 0.5, network: config.profile.networkId, grantEpoch: consent.grantEpoch, ...item } });
  if (admission.status !== "admitted") throw new Error("Synthetic admission refused");
  await adapter.exposeBrowserJournal(wallet, reqId);
  const { awaitSignature, cancelPending } = await import("../payments/pending-signatures");
  const pending = awaitSignature(wallet, reqId, { requirements, expectedSigner: signer, expectedNonce: admission.journal.nonce }).catch(() => undefined);
  cleanup.push(() => cancelPending(wallet, reqId));
  const paymentRoute = await import("../../app/api/ask/challenge/route");
  const response = await paymentRoute.POST(request("/api/ask/challenge", { reqId }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ sessionId: wallet, reqId, grantEpoch: consent.grantEpoch, sessAddr: signer,
    sourceId: "synthetic-source", kind: "fetch", expectedNonce: admission.journal.nonce, browserAuthorizationProtocol: "durable-v1",
    requirements, paymentContext: { item } });
  expect((await paymentRoute.POST(request("/api/ask/challenge", { reqId, sourceId: "invented" }))).status).toBe(400);
  cancelPending(wallet, reqId); await pending;
  expect((await paymentRoute.POST(request("/api/ask/challenge", { reqId }))).status).toBe(409);
  expect((await adapter.getSessionGrant(wallet))!.spent).toBe(0.5);
  // Synthetic terminal evidence updates native accounting; no live facilitator or funds.
  expect(await adapter.settlePendingPayment(admission.journal.payment.id!, admission.journal.nonce, "synthetic-confirmed-transfer")).toBe(true);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ token: "USDC", balances: [{ depositor: signer, domain: 26, balance: "0.5" }] })));
  // A prior debit that confirms after its admission timestamp cannot manufacture
  // deposit credit against a later/equal balance baseline.
  expect(await (await credit(admission.journal.admittedAt)).json()).toMatchObject({ status: "known", available: "500000",
    confirmedSpentMicroUsdc: "500000", retainedSpentMicroUsdc: "500000", postBaselineConfirmedDebitMicroUsdc: "0" });
  expect(await (await credit("2000-01-01T00:00:00.000Z")).json()).toMatchObject({ postBaselineConfirmedDebitMicroUsdc: "500000" });
  const renewal = await (await challengeRoute.POST(request("/api/session/grant/challenge", { sessAddr: signer, budgetMicros: "500000", recover: true }))).json();
  expect(renewal.consent.capMicroUsdc).toBe("1000000");
  expect(renewal.funding).toEqual({ availableMicroUsdc: "500000", confirmedSpentMicroUsdc: "500000",
    retainedSpentMicroUsdc: "500000", proposedRemainingMicroUsdc: "500000" });
  const renewedSignature = await owner.signMessage({ message: messages.createSessionGrantConsentMessage(renewal.consent, config.profile) });
  const renewedSessionSignature = await session.signMessage({ message: messages.createSessionGrantSignerProofMessage(renewal.consent, config.profile) });
  const renewed = await grantRoute.POST(request("/api/session/grant", { consent: renewal.consent, signature: renewedSignature, sessionSignature: renewedSessionSignature }));
  expect(renewed.status).toBe(200);
  expect(await renewed.json()).toMatchObject({ cap: 1, capMicroUsdc: "1000000", spentMicroUsdc: "500000" });
  const unknownId = randomUUID(), unknown = await adapter.admitBrowserJournal({ sessionId: wallet, requestId: unknownId, queryId,
    grantEpoch: renewal.consent.grantEpoch, signer, network: config.profile.networkId, token: config.profile.usdcAddress,
    gatewayContract: config.profile.gatewayWallet, sourceId: "synthetic-source", offerId: null, kind: "fetch", payee,
    amountMicroUsdc: 100000, requirements: { ...requirements, amount: "100000" }, paymentContext: { item },
    payment: { queryId, sourceId: "synthetic-source", sourceName: "Source", kind: "fetch", payer: signer, payee,
      amountUsdc: 0.1, network: config.profile.networkId, grantEpoch: renewal.consent.grantEpoch, ...item } });
  expect(unknown.status).toBe("admitted"); await adapter.exposeBrowserJournal(wallet, unknownId);
  const heldProposal = await (await challengeRoute.POST(request("/api/session/grant/challenge", { sessAddr: signer, budgetMicros: "500000", recover: true }))).json();
  expect(heldProposal.consent.capMicroUsdc).toBe("1000000");
  expect(heldProposal.funding).toEqual({ availableMicroUsdc: "500000", confirmedSpentMicroUsdc: "500000",
    retainedSpentMicroUsdc: "600000", proposedRemainingMicroUsdc: "400000" });
  expect((await (await grantRoute.GET(new NextRequest("https://keryx.cc/api/session/grant"))).json()).spentMicroUsdc).toBe("600000");
  expect((await adapter.getBrowserJournal(wallet, unknownId))!.phase).toBe("exposed");
  expect(await (await credit("2000-01-01T00:00:00.000Z")).json()).toMatchObject({ confirmedSpentMicroUsdc: "500000",
    retainedSpentMicroUsdc: "600000", postBaselineConfirmedDebitMicroUsdc: "500000" });
  expect((await grantRoute.POST(request("/api/session/grant", { consent, signature, sessionSignature }))).status).toBe(409);
  expect((await adapter.getSessionGrant(wallet))!.grantEpoch).toBe(renewal.consent.grantEpoch);
  const recovery = await import("../../app/api/session/authorizations/[reqId]/route");
  const read = (id: string) => recovery.GET(new NextRequest(`https://keryx.cc/api/session/authorizations/${id}`),
    { params: Promise.resolve({ reqId: id }) });
  expect(await (await read(reqId)).json()).toMatchObject({ settlementConfirmed: true, retryAuthorized: false,
    journal: { nonce: admission.journal.nonce, grantEpoch: consent.grantEpoch, phase: "settled", payment: { txHash: "synthetic-confirmed-transfer" } } });
  await adapter.revokeSessionGrant(wallet, renewal.consent.grantEpoch, signer);
  const unresolved = await read(unknownId);
  expect(unresolved.status).toBe(200);
  expect(await unresolved.json()).toMatchObject({ settlementConfirmed: false, retryAuthorized: false,
    journal: { phase: "exposed", nonce: unknown.status === "admitted" ? unknown.journal.nonce : "" } });
  authenticatedWallet = payee;
  expect((await read(reqId)).status).toBe(404);
  expect((await credit(undefined, renewal.consent.grantEpoch)).status).toBe(503);
}, 30000);
