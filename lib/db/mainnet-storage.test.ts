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

it("admits hosted SDK originals before crypto and vendor exposure and retains lifetime caps across policy renewal", async () => {
  const { adapter, file, identity } = await fixture();
  const actualAccounts = await import("viem/accounts");
  const account = actualAccounts.privateKeyToAccount(`0x${"77".repeat(32)}`), signer = account.address.toLowerCase(), payee = `0x${"33".repeat(20)}`;
  const { storageIdentityDigest } = await import("./storage-identity"), policies = await import("../payments/hosted-treasury-policy");
  const policy = { format: "keryx-hosted-treasury-policy-v1" as const, network: "eip155:5042" as const,
    storageIdentityDigest: storageIdentityDigest(identity), origin: "https://keryx.cc", signer,
    lifetimeCapMicroUsdc: "4000", queryCapMicroUsdc: "2000", expiresAtSeconds: Math.floor(Date.now()/1000)+3600 };
  const selectPolicy = (value: typeof policy) => {
    vi.stubEnv("KERYX_MAINNET_TREASURY_POLICY_JSON", canonicalJson(value));
    vi.stubEnv("KERYX_MAINNET_TREASURY_POLICY_DIGEST", policies.hostedTreasuryPolicyDigest(value));
  };
  const native = new DatabaseSync(file); cleanup.push(()=>native.close());
  const events: string[] = [];
  vi.doMock("viem/accounts", () => ({ ...actualAccounts, privateKeyToAccount: (key: `0x${string}`) => {
    const real=actualAccounts.privateKeyToAccount(key);
    return { ...real, signTypedData: async (typed: Parameters<typeof real.signTypedData>[0]) => {
      const nonce=String(typed.message!.nonce).toLowerCase();
      expect(native.prepare("SELECT submitted,header_hash FROM hosted_treasury_authorizations WHERE nonce=?").get(nonce)).toEqual({ submitted:0,header_hash:null });
      const original=JSON.parse(String(native.prepare("SELECT original FROM hosted_treasury_authorizations WHERE nonce=?").get(nonce)!.original));
      expect(native.prepare("SELECT authorization_id FROM payment_events WHERE id=?").get('x402:'+nonce)?.authorization_id).toBe(original.context.privateJob ? undefined : nonce);
      events.push("reserved-before-crypto"); return real.signTypedData(typed);
    } };
  } })); cleanup.push(()=>vi.doUnmock("viem/accounts"));
  vi.doMock("../registry/source-fetch-payto",()=>({ sourceFetchPayTo:async()=>payee })); cleanup.push(()=>vi.doUnmock("../registry/source-fetch-payto"));
  const profile=(await import("../config")).config.profile, source={id:"source",name:"Source",fetchPrice:0.002} as unknown as import("../types").Source;
  let loseResponse=false, paidCalls=0;
  vi.stubGlobal("fetch",vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
    const target=String(url);
    if(target.endsWith("/v1/balances")) return Response.json({token:"USDC",balances:[{depositor:JSON.parse(String(init?.body)).sources[0].depositor,domain:26,balance:"1"}]});
    if(target===profile.rpcUrl || target===profile.rpcUrl+'/') { const rpc=JSON.parse(String(init?.body)); expect(rpc.method).toBe("eth_chainId"); return Response.json({jsonrpc:"2.0",id:rpc.id,result:"0x13b2"}); }
    if(target.startsWith("https://keryx.cc/api/source/")) {
      const header=(init?.headers as Record<string,string>)["Payment-Signature"];
      if(!header) return new Response(null,{status:402,headers:{"PAYMENT-REQUIRED":Buffer.from(JSON.stringify({x402Version:2,accepts:[{
        scheme:"exact",network:profile.networkId,asset:profile.usdcAddress,amount:"2000",payTo:payee,maxTimeoutSeconds:691200,
        extra:{name:"GatewayWalletBatched",version:"1",verifyingContract:profile.gatewayWallet}}]})).toString("base64")}});
      const payload=JSON.parse(Buffer.from(header,"base64").toString()),nonce=payload.payload.authorization.nonce;
      expect(native.prepare("SELECT submitted,header_hash FROM hosted_treasury_authorizations WHERE nonce=?").get(nonce)).toMatchObject({submitted:1,header_hash:expect.stringMatching(/^0x[0-9a-f]{64}$/)});
      events.push("submitted-before-http"); paidCalls++;
      if(loseResponse) throw new Error("synthetic response loss");
      return Response.json({content:"Actual synthetic paid body"},{headers:{"PAYMENT-RESPONSE":Buffer.from(JSON.stringify({success:true,transaction:"synthetic-settlement",payer:payload.payload.authorization.from,network:profile.networkId})).toString("base64")}});
    }
    throw new Error("Unexpected synthetic hosted transport");
  }));
  selectPolicy(policy); vi.stubEnv("KERYX_MAINNET_TREASURY_PRIVATE_KEY",`0x${"77".repeat(32)}`);
  vi.stubEnv("AGENT_FUNDER_PRIVATE_KEY",`0x${"11".repeat(32)}`); // Accidental legacy key never selects custody.
  const readiness=await import("../payments/mainnet-hosted-gateway"), beforePrepayCalls=vi.mocked(globalThis.fetch).mock.calls.length;
  vi.stubEnv("KERYX_MAINNET_TREASURY_PRIVATE_KEY",`0x${"44".repeat(32)}`);
  await expect(readiness.assertMainnetHostedResearchReady(adapter,"2000")).rejects.toThrow("custody unavailable");
  expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(beforePrepayCalls);
  expect(native.prepare("SELECT count(*) AS n FROM hosted_treasury_policies").get()?.n).toBe(0);
  vi.stubEnv("KERYX_MAINNET_TREASURY_PRIVATE_KEY",`0x${"77".repeat(32)}`);
  await readiness.assertMainnetHostedResearchReady(adapter,"2000");
  expect(events).toEqual([]);
  expect(native.prepare("SELECT count(*) AS n FROM hosted_treasury_policies").get()?.n).toBe(0);
  const factory=await import("../payments/payment-gateway"), gateway=await factory.getPaymentGateway(adapter);
  await gateway.ensureFunded(0.002);
  const first=await gateway.payFetch({source:source as unknown as import("../types").Source,queryId:randomUUID()});
  expect(first.content).toBe("Actual synthetic paid body"); expect(first.payment.settled).toBe(true);
  expect(events).toEqual(["reserved-before-crypto","submitted-before-http"]);
  expect(await adapter.hostedTreasuryAccounting(signer)).toEqual({retainedMicroUsdc:"2000",confirmedMicroUsdc:"2000"});
  // The next scope has a new reviewed expiry, but the SAME lifetime signer
  // reservation persists. Unknown vendor exposure cannot replenish its capacity.
  selectPolicy({...policy,expiresAtSeconds:policy.expiresAtSeconds+1}); loseResponse=true;
  const other=await (await import("./enrolled-sqlite-adapter")).createEnrolledSqliteAdapter(); cleanup.push(()=>other.close());
  const renewed=await factory.getPaymentGateway(adapter), concurrent=await factory.getPaymentGateway(other);
  await renewed.ensureFunded(0.002); await concurrent.ensureFunded(0.002);
  const raced=await Promise.allSettled([renewed.payFetch({source,queryId:randomUUID()}),concurrent.payFetch({source,queryId:randomUUID()})]);
  expect(raced.map(result=>result.status)).toEqual(["rejected","rejected"]);
  expect(raced.filter(result=>result.status==='rejected' && result.reason.message.includes('settlement confirmation pending'))).toHaveLength(1);
  expect(raced.filter(result=>result.status==='rejected' && result.reason.message.includes('local signing policy'))).toHaveLength(1);
  expect(paidCalls).toBe(2); expect(await adapter.hostedTreasuryAccounting(signer)).toEqual({retainedMicroUsdc:"4000",confirmedMicroUsdc:"2000"});
  const exhausted=await factory.getPaymentGateway(adapter); await expect(exhausted.ensureFunded(0.002)).rejects.toThrow("prefunding");
  expect(paidCalls).toBe(2);
  expect(await other.hostedTreasuryAccounting(signer)).toEqual({retainedMicroUsdc:"4000",confirmedMicroUsdc:"2000"});
  const original=native.prepare("SELECT nonce,header_hash,original FROM hosted_treasury_authorizations ORDER BY rowid DESC LIMIT 1").get()!;
  const m=JSON.parse(String(original.original)).payload.message;
  await expect(other.submitHostedAuthorization(signer,{authorizationId:String(original.nonce),payer:signer,payee,
    amountMicros:String(m.value),network:profile.networkId,asset:profile.usdcAddress.toLowerCase(),
    authorizationExpiresAt:new Date(Number(m.validBefore)*1000).toISOString()},String(original.header_hash))).rejects.toThrow("do not resubmit");
  // Private jobs reuse their actual owner-verified intent, incoming settlement and
  // single-use execution claim. Creator metadata remains in the private ledger.
  const buyer=actualAccounts.privateKeyToAccount(`0x${"11".repeat(32)}`), privateAccount=actualAccounts.privateKeyToAccount(`0x${"88".repeat(32)}`);
  const merchants={privatePayee:`0x${"aa".repeat(20)}`,publicResearchPayee:`0x${"bb".repeat(20)}`};
  const requirement={scheme:"exact",network:profile.networkId,asset:profile.usdcAddress,amount:"50000",payTo:merchants.privatePayee,maxTimeoutSeconds:691200,
    extra:{name:"GatewayWalletBatched",version:"1",verifyingContract:profile.gatewayWallet}};
  const input={question:"Synthetic private authority marker",budget:0.03,researchMode:"quick",packageVersion:"1.0.0",responseMode:"async",access:"payer-private-v1",model:null};
  const fresh=await (await import("../buyer/private-request-commitment")).createPrivateAuthorization(input,requirement,buyer.address,merchants);
  const signature=await buyer.signTypedData((await import("../buyer/protocol")).buyerTypedData(fresh.authorization));
  const intent=await (await import("../a2a/private-research-intent")).preparePrivateResearchIntent({request:fresh.request,salt:fresh.salt,payment:{authorization:fresh.authorization,signature}},requirement,merchants);
  await adapter.reservePrivateResearchIntent(intent); await adapter.claimPrivatePaymentSubmission(intent.id,buyer.address);
  await adapter.confirmPrivatePayment(intent.id,buyer.address,{source:"circle-facilitator-success",transaction:"synthetic-incoming-settlement",network:profile.networkId,
    payer:buyer.address,payee:merchants.privatePayee,amountMicros:"50000",authorizationId:fresh.authorization.nonce});
  const claim=await adapter.claimPrivateResearchExecution(intent.id,buyer.address); expect(claim).not.toBeNull();
  const privatePolicy={...policy,signer:privateAccount.address.toLowerCase(),lifetimeCapMicroUsdc:"100000",queryCapMicroUsdc:"30000"};
  vi.stubEnv("KERYX_MAINNET_PRIVATE_TREASURY_POLICY_JSON",canonicalJson(privatePolicy));
  vi.stubEnv("KERYX_MAINNET_PRIVATE_TREASURY_POLICY_DIGEST",policies.hostedTreasuryPolicyDigest(privatePolicy));
  vi.stubEnv("KERYX_MAINNET_PRIVATE_TREASURY_PRIVATE_KEY",`0x${"88".repeat(32)}`); loseResponse=false;
  const privateGateway=await (await import("../payments/mainnet-hosted-gateway")).createMainnetHostedGateway(adapter,{role:"private",
    job:{id:intent.id,owner:buyer.address.toLowerCase(),workerId:claim!.workerId}});
  await privateGateway.ensureFunded(0.03); const privateResult=await privateGateway.payFetch({source,queryId:intent.id}); expect(privateResult.payment.settled).toBe(true);
  expect(native.prepare("SELECT count(*) AS n FROM payment_events WHERE payer=?").get(privatePolicy.signer)?.n).toBe(0);
  expect((await adapter.listPrivateCreatorSubmissions(intent.id,buyer.address)).length).toBe(1);
  expect(await adapter.hostedTreasuryAccounting(privatePolicy.signer)).toEqual({retainedMicroUsdc:"2000",confirmedMicroUsdc:"2000"});
  await expect(other.admitHostedTreasuryPolicy({...policy,expiresAtSeconds:policy.expiresAtSeconds+100},"private"))
    .rejects.toThrow("Historical hosted custody role cannot change");
  await expect(other.admitHostedTreasuryPolicy({...privatePolicy,expiresAtSeconds:privatePolicy.expiresAtSeconds+100},"public"))
    .rejects.toThrow("Historical hosted custody role cannot change");
  selectPolicy({...privatePolicy,expiresAtSeconds:privatePolicy.expiresAtSeconds+100});
  vi.stubEnv("KERYX_MAINNET_TREASURY_PRIVATE_KEY",`0x${"88".repeat(32)}`);
  const callsBeforeRoleRead=vi.mocked(globalThis.fetch).mock.calls.length;
  await expect(readiness.assertMainnetHostedResearchReady(adapter,"2000")).rejects.toThrow("Historical hosted custody role cannot change");
  expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(callsBeforeRoleRead);
},60000);

it("recovers expired owner custody through normal withdrawal handlers while preserving unknown holds and one original burn", async () => {
  const { adapter } = await fixture();
  // This synthetic RPC's fixed block timestamps must not age while native storage
  // assertions run; live RPC freshness has separate focused coverage.
  vi.useFakeTimers({ toFake: ["Date"] });
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
  vi.stubEnv("NEXT_PUBLIC_KERYX_WITHDRAWAL_MAX_AHEAD_BLOCKS", "100");
  vi.stubEnv("KERYX_WITHDRAWAL_MAX_VALUE_MICROS", "1000000");
  vi.stubEnv("KERYX_WITHDRAWAL_MAX_PROCESSING_LAG_BLOCKS", "10");
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init: RequestInit) => {
    const target = String(url);
    if (target.endsWith("/v1/balances")) return Response.json({ token: "USDC", balances: [{ depositor: JSON.parse(String(init.body)).sources[0].depositor, domain: 26, balance: availableBalance }] });
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
    headers: { Origin: "https://keryx.cc", Host: "keryx.cc", "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
  expect(prepared.status).toBe(200); let p = await prepared.json();
  expect(p).toMatchObject({ ownerAddr: wallet, sessAddr: signer, network: profile.networkId,
    balance: { heldPaymentMicroUsdc: "100000", maxFeeMicroUsdc: "1000" },
    burnIntent: { spec: { destinationRecipient: pad(wallet as `0x${string}`, { size: 32 }), value: "800000" } } });
  const authorize = await import("../../app/api/session/withdraw/authorize/route"), cancel = await import("../../app/api/session/withdraw/cancel/route");
  // An explicit pre-crypto cancellation retains the original and permits a new
  // reviewed preparation. Even a valid burn signature cannot revive that old ID.
  const cancelled = await cancel.POST(request("/api/session/withdraw/cancel", { requestId: p.requestId }));
  expect(cancelled.status).toBe(200);
  expect(await cancelled.json()).toMatchObject({ preparation: p, signingPhase: "cancelled_unexposed",
    cancellation: { requestId: p.requestId, ownerAddr: wallet, sessAddr: signer, reason: "cancelled-unexposed" } });
  const oldSignature = await session.signTypedData((await import("../gateway/withdraw-protocol")).withdrawTypedData(p.burnIntent));
  expect((await submit.POST(request("/api/session/withdraw/submit", { requestId: p.requestId, signature: oldSignature }))).status).toBe(503);
  expect((await authorize.POST(request("/api/session/withdraw/authorize", { requestId: p.requestId }))).status).toBe(409);
  await expect(other.reserveSessionWithdrawal(p)).rejects.toThrow();
  expect(await adapter.pendingSessionWithdrawal(wallet, signer)).toBeNull(); expect(transferCalls).toBe(0);
  // A lost acknowledgement of never-exposed cancellation must also resolve a new
  // local publication fence; both immutable server outcomes remain retained.
  const cancelAbort = await import("../../app/api/session/withdraw/abort/route"), cancelAbortProof = await import("../gateway/session-withdrawal-abort");
  const cancelAbortBody = { requestId: p.requestId, signature: await session.signMessage({ message: cancelAbortProof.sessionWithdrawalAbortMessage(p) }) };
  expect((await cancelAbort.POST(request("/api/session/withdraw/abort", cancelAbortBody))).status).toBe(200);
  expect(await adapter.getSessionWithdrawalSigningPhase(p.requestId, wallet)).toBe("aborted_before_publication");
  // Exposure without signature publication is recoverable through an authenticated
  // local abort, retaining history and preventing every old signing/submission path.
  const interrupted = await (await prepare.POST(request("/api/session/withdraw/prepare", { sessAddr: signer, grantEpoch: consent.grantEpoch, amountMicros: "800000" }))).json();
  await adapter.authorizeSessionWithdrawal(interrupted.requestId, wallet);
  const abort = await import("../../app/api/session/withdraw/abort/route"), abortProof = await import("../gateway/session-withdrawal-abort");
  const abortBody = { requestId: interrupted.requestId, signature: await session.signMessage({ message: abortProof.sessionWithdrawalAbortMessage(interrupted) }) };
  expect((await abort.POST(request("/api/session/withdraw/abort", { ...abortBody, signature: await owner.signMessage({ message: abortProof.sessionWithdrawalAbortMessage(interrupted) }) }))).status).toBe(409);
  authenticatedWallet = payee;
  expect((await abort.POST(request("/api/session/withdraw/abort", abortBody))).status).toBe(404);
  authenticatedWallet = wallet;
  for (let replay = 0; replay < 2; replay++) {
    const response = await abort.POST(request("/api/session/withdraw/abort", abortBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ signingPhase: "aborted_before_publication", cancellation: null, completion: null,
      publicationAbort: { requestId: interrupted.requestId, signature: abortBody.signature }, progress: { chainFinalityVerified: false } });
  }
  expect(await adapter.pendingSessionWithdrawal(wallet, signer)).toBeNull();
  expect((await adapter.sessionWithdrawalAccounting(signer)).heldWithdrawalMicroUsdc).toBe("0");
  await expect(other.authorizeSessionWithdrawal(interrupted.requestId, wallet)).rejects.toThrow();
  await expect(other.reserveSessionWithdrawal(interrupted)).rejects.toThrow();
  const oldRequest = await (await import("../gateway/withdrawal-request")).createWithdrawalRequest({ burnIntent: interrupted.burnIntent,
    signature: await session.signTypedData((await import("../gateway/withdraw-protocol")).withdrawTypedData(interrupted.burnIntent)) }, interrupted.policy, profile);
  await expect(other.reserveCreatorWithdrawal(oldRequest)).rejects.toThrow();
  expect(await adapter.getSessionWithdrawal(interrupted.requestId, wallet)).toEqual(interrupted);
  expect((await adapter.getSessionGrant(wallet))?.expiry).toBe(0);
  const newPreparation = await prepare.POST(request("/api/session/withdraw/prepare", { sessAddr: signer, grantEpoch: consent.grantEpoch, amountMicros: "800000" }));
  expect(newPreparation.status).toBe(200); const previousId = p.requestId; p = await newPreparation.json(); expect(p.requestId).not.toBe(previousId);
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
  // Two actual native connections race cancel vs authorize. Authorization wins
  // this scheduling order and the other transaction must retain the exposure.
  const transitions = await Promise.allSettled([adapter.authorizeSessionWithdrawal(p.requestId, wallet), other.cancelSessionWithdrawal(p.requestId, wallet)]);
  expect(transitions.map(result => result.status)).toEqual(["fulfilled", "rejected"]);
  expect((await authorize.POST(request("/api/session/withdraw/authorize", { requestId: p.requestId }))).status).toBe(200);
  const signature = await session.signTypedData((await import("../gateway/withdraw-protocol")).withdrawTypedData(p.burnIntent));
  const body = { requestId: p.requestId, signature };
  const sent = await submit.POST(request("/api/session/withdraw/submit", body)); expect(sent.status).toBe(200);
  expect(await sent.json()).toMatchObject({ preparation: p, progress: { status: "awaiting-transfer-evidence", retryAuthorized: false }, mint: null, completion: null });
  expect((await submit.POST(request("/api/session/withdraw/submit", body))).status).toBe(200); expect(transferCalls).toBe(1);
  expect((await cancel.POST(request("/api/session/withdraw/cancel", { requestId: p.requestId }))).status).toBe(409);
  expect((await abort.POST(request("/api/session/withdraw/abort", { requestId: p.requestId,
    signature: await session.signMessage({ message: abortProof.sessionWithdrawalAbortMessage(p) }) }))).status).toBe(409);
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
  // Ordinary creator cashout uses the connected OWNER wallet, not a gas relay or
  // treasury fallback, through the existing public creator endpoints.
  availableBalance="1";
  const creatorPrepare=await import("../../app/api/me/withdrawals/prepare/route"),creatorSubmit=await import("../../app/api/me/withdrawals/submit/route");
  const creatorStatus=await import("../../app/api/me/withdrawals/status/route"),creatorComplete=await import("../../app/api/me/withdrawals/complete/route");
  const draftResponse=await creatorPrepare.POST(request("/api/me/withdrawals/prepare",{amountMicros:"800000"}));
  expect(draftResponse.status).toBe(200);
  const draft=(await draftResponse.json()).draft;
  expect(draft.policy.owner).toBe(wallet); expect(draft.policy.recipient).toBe(wallet);
  const creatorSignature=await owner.signTypedData((await import("../gateway/withdraw-protocol")).withdrawTypedData(draft.burnIntent));
  const creatorBody={burnIntent:draft.burnIntent,signature:creatorSignature};
  const creatorSent=await creatorSubmit.POST(request("/api/me/withdrawals/submit",creatorBody));expect(creatorSent.status).toBe(202);
  expect(await creatorSent.json()).toMatchObject({wallet,record:{id:draft.id,network:profile.networkId},progress:{status:"awaiting-transfer-evidence",retryAuthorized:false},mint:null,completion:null});
  expect(transferCalls).toBe(2);
  expect((await creatorSubmit.POST(request("/api/me/withdrawals/submit",creatorBody))).status).toBe(202);expect(transferCalls).toBe(2);
  expect((await adapter.creatorOwnerWithdrawalAccounting(wallet)).heldWithdrawalMicroUsdc).toBe("801000");
  await expect(other.upsertSessionGrant({sessionId:payee,ownerAddr:payee,sessAddr:wallet,grantEpoch:randomUUID(),cap:1,
    expiry:Date.now()+60000,txHash:"synthetic-cannot-ignore-burn"})).rejects.toThrow("paused");
  const creatorRecord=(await adapter.getCreatorWithdrawal(draft.id,wallet))!;
  const secondIntent=(await import("../gateway/withdraw-intent-core")).prepareWithdrawIntentForProfile(profile,wallet,"300000",wallet,"1000");
  secondIntent.maxBlockHeight="10010";
  const secondSignature=await owner.signTypedData((await import("../gateway/withdraw-protocol")).withdrawTypedData(secondIntent));
  const secondRecord=await (await import("../gateway/withdrawal-request")).createWithdrawalRequest({burnIntent:secondIntent,signature:secondSignature},
    {...creatorRecord.policy,maxValueMicros:"300000"},profile);
  await expect(other.admitCreatorOwnerWithdrawal(secondRecord,await other.creatorOwnerWithdrawalAccounting(wallet),"1000000")).rejects.toThrow("capacity");
  await expect(other.reserveCreatorWithdrawal(secondRecord)).rejects.toThrow("capacity admission");
  authenticatedWallet=payee;
  expect((await creatorStatus.POST(request("/api/me/withdrawals/status",{id:draft.id}))).status).toBe(404);
  authenticatedWallet=wallet;
  const creatorSpec=creatorRecord.request.burnIntent.spec,creatorClaim=(await adapter.getCreatorWithdrawalTransferClaim(draft.id,wallet))!;
  const creatorEncodedSpec="ca85def7000000010000001a0000001a"+[creatorSpec.sourceContract,creatorSpec.destinationContract,creatorSpec.sourceToken,
    creatorSpec.destinationToken,creatorSpec.sourceDepositor,creatorSpec.destinationRecipient,creatorSpec.sourceSigner,creatorSpec.destinationCaller].map(v=>v.slice(2)).join("")+
    BigInt(creatorSpec.value).toString(16).padStart(64,"0")+creatorSpec.salt.slice(2)+"00000000";
  const creatorAttestation=`0xff6fb334${BigInt(10020).toString(16).padStart(64,"0")}00000154${creatorEncodedSpec}` as `0x${string}`;
  const creatorVendor={transferId:randomUUID(),attestation:creatorAttestation,expirationBlock:"10020",
    signature:await attester.signMessage({message:{raw:keccak256(creatorAttestation)}})};
  await adapter.saveCreatorWithdrawalAttestation(draft.id,wallet,creatorClaim.claimId,creatorVendor);
  const creatorObserved=await creatorStatus.POST(request("/api/me/withdrawals/status",{id:draft.id}));expect(creatorObserved.status).toBe(200);
  const creatorView=await creatorObserved.json();expect(creatorView.mint).toMatchObject({to:profile.gatewayMinter.toLowerCase(),network:profile.networkId,value:"0"});
  const creatorRaw=await owner.signTransaction({type:"eip1559",chainId:profile.chainId,nonce:1,gas:BigInt(300000),maxFeePerGas:BigInt(2000000000),
    maxPriorityFeePerGas:BigInt(1000000000),to:profile.gatewayMinter,value:BigInt(0),data:creatorView.mint.data});
  const creatorTx=parseTransaction(creatorRaw),creatorHash=keccak256(creatorRaw);
  mintTransaction={...mintTransaction,nonce:"0x1",input:creatorView.mint.data,hash:creatorHash,r:creatorTx.r,s:creatorTx.s,yParity:toHex(creatorTx.yParity!)};
  const creatorSpecHash=(await import("../gateway/withdrawal-attestation")).withdrawalTransferSpecHash(creatorRecord);
  const oldLog=(mintReceipt!.logs as Record<string,unknown>[])[0];
  mintReceipt={...mintReceipt,transactionHash:creatorHash,logs:[{...oldLog,transactionHash:creatorHash,
    topics:encodeEventTopics({abi:WITHDRAWAL_MINT_EVENT,eventName:"AttestationUsed",args:{token:profile.usdcAddress,recipient:wallet as `0x${string}`,transferSpecHash:creatorSpecHash}}),
    data:encodeAbiParameters([{type:"uint32"},{type:"bytes32"},{type:"bytes32"},{type:"uint256"}],[26,creatorSpec.sourceDepositor,creatorSpec.sourceSigner,BigInt(creatorSpec.value)])}]};
  const creatorFinal=await creatorComplete.POST(request("/api/me/withdrawals/complete",{id:draft.id,transactionHash:creatorHash}));expect(creatorFinal.status).toBe(200);
  expect(await creatorFinal.json()).toMatchObject({progress:{chainFinalityVerified:true,status:"mint-finalized-observed"},
    completion:{requestId:draft.id,serializedTransaction:creatorRaw,observation:{transactionHash:creatorHash,chainId:profile.chainId}}});
  expect((await other.creatorOwnerWithdrawalAccounting(wallet)).heldWithdrawalMicroUsdc).toBe("0");
  expect((await other.creatorOwnerWithdrawalAccounting(wallet)).confirmedWithdrawalMicroUsdc).toBe("801000");
  expect(transferCalls).toBe(2);
}, 90000);
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


it("admits original mainnet research claims and atomically allocates four immutable Monthly slots on separate native connections", async()=> {
  const {adapter,file}=await fixture();
  const other=await (await import("./enrolled-sqlite-adapter")).createEnrolledSqliteAdapter();cleanup.push(()=>other.close());
  const readonly=await (await import("./enrolled-sqlite-adapter")).createReadonlyEnrolledSqliteAdapter();cleanup.push(()=>readonly.close());
  const p=ARC_MAINNET_PROFILE,network:string=p.networkId,payer=`0x${"11".repeat(20)}`,payee=`0x${"22".repeat(20)}`;
  const monthly=await import("./research-monthly"),{a2aRequestHash}=await import("../a2a/order"),{a2aResearchPackage}=await import("../a2a/research-package");
  await adapter.assertResearchPurchaseAuthority(network);
  await expect(adapter.assertResearchPurchaseAuthority(ARC_TESTNET_PROFILE.networkId)).rejects.toThrow("profile mismatch");
  expect(()=>readonly.assertResearchPurchaseAuthority(network)).toThrow("mutation refused");
  const native=new DatabaseSync(file);cleanup.push(()=>native.close());
  const claim={network,payer,payee,authorizationId:`0x${"ac".repeat(32)}`,purpose:"resource" as const,requestHash:"a".repeat(64),amountMicros:2000};
  await adapter.claimResearchPurchase(claim);await other.claimResearchPurchase(claim);
  await expect(other.claimResearchPurchase({...claim,purpose:"monthly"})).rejects.toThrow("conflict");
  await expect(other.claimResearchPurchase({...claim,network:ARC_TESTNET_PROFILE.networkId})).rejects.toThrow();
  expect(native.prepare("SELECT count(*) AS n FROM research_purchase_authorizations").get()?.n).toBe(1);
  expect(()=>native.prepare("UPDATE research_purchase_authorizations SET amount_micros=1").run()).toThrow();
  const authorizationId=`0x${"bc".repeat(32)}`,createdAt=new Date().toISOString();
  const purchase:import("./research-monthly").MonthlyPurchase={format:"keryx-research-monthly-purchase-v2",network,asset:p.usdcAddress.toLowerCase(),gatewayContract:p.gatewayWallet.toLowerCase(),
    id:monthly.monthlyPurchaseId({network,payer,payee,authorizationId}),payer,payee,authorizationId,transaction:"synthetic-original-settlement",quoteId:"b".repeat(64),createdAt,
    expiresAt:new Date(Date.parse(createdAt)+monthly.MONTHLY_TERM_MS).toISOString(),creatorBudgetMicros:50000,serviceFeeMicros:180000,totalMicros:380000,researchPackage:a2aResearchPackage("deep")};
  const seconds=Math.floor(Date.now()/1000),issued={validAfter:String(seconds-600),validBefore:String(seconds+691200),expiresAt:String(seconds+600)};
  const monthlyClaim={network,payer,payee,authorizationId,purpose:"monthly" as const,requestHash:purchase.quoteId,amountMicros:purchase.totalMicros,issued};
  await adapter.claimResearchPurchase(monthlyClaim);
  expect(await adapter.getResearchMonthly(purchase.id)).toBeNull();
  await expect(adapter.createResearchMonthly(purchase)).rejects.toThrow("Submitted original");
  await other.claimResearchPurchase({...monthlyClaim,requireExisting:true});
  expect((await adapter.createResearchMonthly(purchase)).created).toBe(true);
  expect((await other.createResearchMonthly(purchase)).created).toBe(false);
  await expect(other.createResearchMonthly({...purchase,transaction:"foreign-transaction"})).rejects.toThrow("replay conflict");
  await expect(other.createResearchMonthly({...purchase,network:ARC_TESTNET_PROFILE.networkId})).rejects.toThrow();
  const unlabelled={...purchase};delete unlabelled.format;delete unlabelled.network;delete unlabelled.asset;delete unlabelled.gatewayContract;
  await expect(other.createResearchMonthly(unlabelled)).rejects.toThrow();
  const request=(requestId:string,question="Explain original network evidence")=>{
    const id=monthly.monthlyOrderId(purchase.id,requestId),order={id,queryId:id,authorizationId:authorizationId+":monthly:"+requestId,payer,payee,transaction:purchase.transaction,
      amountUsdc:purchase.totalMicros/4/1e6,creatorBudgetUsdc:purchase.creatorBudgetMicros/1e6,serviceFeeUsdc:purchase.serviceFeeMicros/4/1e6,researchMode:purchase.researchPackage.researchMode,
      researchPackage:purchase.researchPackage,status:"running" as const,request:{question,origin:"a2a" as const,monthlyId:purchase.id,network},startedAt:null,workerId:null,
      executionJournalVersion:1 as const,paymentStartedAt:null,resultSavingAt:null,response:null,errorCode:null,resolution:null,createdAt,updatedAt:createdAt};
    return {monthlyId:purchase.id,payer,requestId,now:createdAt,order:{...order,requestHash:a2aRequestHash({...order,question})}};
  };
  const wrong=request("wrong-network");wrong.order.request.network=ARC_TESTNET_PROFILE.networkId;
  await expect(adapter.redeemResearchMonthly(wrong)).rejects.toThrow("contract mismatch");
  const results=await Promise.allSettled(Array.from({length:5},(_,i)=>(i%2?adapter:other).redeemResearchMonthly(request("slot-"+i))));
  expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(4);expect(results.filter(x=>x.status==="rejected")).toHaveLength(1);
  expect((await other.redeemResearchMonthly(request("slot-0"))).created).toBe(false);
  await expect(other.redeemResearchMonthly(request("slot-0","Changed original question"))).rejects.toThrow("replay conflict");
  const restored=await readonly.getResearchMonthly(purchase.id);
  expect(restored?.purchase).toEqual(purchase);expect(restored?.redemptions.map(x=>x.slot)).toEqual([0,1,2,3]);
  expect(native.prepare("SELECT count(*) AS n FROM a2a_orders").get()?.n).toBe(4);
  expect(native.prepare("SELECT network,product FROM research_purchase_authorizations WHERE authorization_id=?").get(authorizationId)).toEqual({network,product:"monthly"});
  expect(()=>native.prepare("DELETE FROM research_monthly_redemptions").run()).toThrow();
},30000);


it("accepts normal public mainnet A2A through actual seller admission without a legacy funder key",async()=> {
  const seller=`0x${"33".repeat(20)}`;
  vi.stubEnv("SELLER_ADDRESS",seller);vi.stubEnv("AGENT_FUNDER_PRIVATE_KEY","");vi.stubEnv("BUYER_PRIVATE_KEY","");
  const {adapter,file,identity}=await fixture();
  const {privateKeyToAccount}=await import("viem/accounts"),buyer=privateKeyToAccount(`0x${"11".repeat(32)}`),treasury=privateKeyToAccount(`0x${"77".repeat(32)}`);
  const {storageIdentityDigest}=await import("./storage-identity"),{hostedTreasuryPolicyDigest}=await import("../payments/hosted-treasury-policy");
  const policy={format:"keryx-hosted-treasury-policy-v1" as const,network:"eip155:5042" as const,storageIdentityDigest:storageIdentityDigest(identity),origin:"https://keryx.cc",
    signer:treasury.address.toLowerCase(),lifetimeCapMicroUsdc:"1000000",queryCapMicroUsdc:"100000",expiresAtSeconds:Math.floor(Date.now()/1000)+3600};
  vi.stubEnv("KERYX_MAINNET_TREASURY_POLICY_JSON",canonicalJson(policy));vi.stubEnv("KERYX_MAINNET_TREASURY_POLICY_DIGEST",hostedTreasuryPolicyDigest(policy));
  const native=new DatabaseSync(file);cleanup.push(()=>native.close());let originalNonce:string|undefined;const paidCalls:string[]=[];
  vi.stubGlobal("fetch",vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
    const target=String(url),body=JSON.parse(String(init?.body));
    if(target.endsWith("/v1/balances")) return Response.json({token:"USDC",balances:[{depositor:policy.signer,domain:26,balance:"1"}]});
    if(target===ARC_MAINNET_PROFILE.rpcUrl || target===ARC_MAINNET_PROFILE.rpcUrl+'/') return Response.json({jsonrpc:"2.0",id:body.id,result:"0x13b2"});
    if(target.startsWith(ARC_MAINNET_PROFILE.gatewayApiUrl) && target.endsWith("/verify")) {paidCalls.push("verify");return Response.json({isValid:true,payer:buyer.address});}
    if(target.startsWith(ARC_MAINNET_PROFILE.gatewayApiUrl) && target.endsWith("/settle")) {
      expect(native.prepare("SELECT network,product FROM research_purchase_authorizations WHERE authorization_id=?").get(originalNonce!)).toEqual({network:ARC_MAINNET_PROFILE.networkId,product:"a2a"});
      paidCalls.push("settle");return Response.json({success:true,payer:buyer.address,network:ARC_MAINNET_PROFILE.networkId,transaction:"synthetic-public-a2a-settlement"});
    }
    throw new Error("Unexpected synthetic public A2A transport");
  }));
  const {NextRequest}=await import("next/server"),route=await import("../../app/api/agent/ask/route");
  const request=(header?:string)=>new NextRequest("https://keryx.cc/api/agent/ask",{method:"POST",headers:{"content-type":"application/json",...(header?{"payment-signature":header}:{})},
    body:JSON.stringify({question:"Review immutable selected network evidence",budget:0.05,researchMode:"deep",responseMode:"async"})});
  vi.stubEnv("KERYX_MAINNET_TREASURY_PRIVATE_KEY",`0x${"44".repeat(32)}`);
  const refused=await route.POST(request());expect(refused.status).toBe(503);expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(native.prepare("SELECT count(*) AS n FROM research_purchase_authorizations").get()?.n).toBe(0);
  vi.stubEnv("KERYX_MAINNET_TREASURY_PRIVATE_KEY",`0x${"77".repeat(32)}`);
  await (await import("../payments/mainnet-hosted-gateway")).assertMainnetHostedResearchReady(adapter,"50000");
  const challenge=await route.POST(request());expect(challenge.status,await challenge.clone().text()).toBe(402);
  const requirement=JSON.parse(Buffer.from(challenge.headers.get("PAYMENT-REQUIRED")!,"base64").toString()).accepts[0];
  expect(requirement.network).toBe(ARC_MAINNET_PROFILE.networkId);expect(requirement.payTo).toBe(seller);
  const protocol=await import("../buyer/protocol");originalNonce=`0x${"ad".repeat(32)}`;
  const authorization=protocol.authorizationWithNonce(buyer.address,requirement,originalNonce),signature=await buyer.signTypedData(protocol.buyerTypedData(authorization));
  const paid=await route.POST(request(Buffer.from(JSON.stringify({authorization,signature})).toString("base64")));
  expect(paid.status).toBe(202);expect(paidCalls).toEqual(["verify","settle"]);
  const result=await paid.json();expect(result.status).toBe("queued");
  const order=await adapter.getA2aOrder(result.queryId);
  expect(order).toMatchObject({payer:buyer.address,payee:seller,transaction:"synthetic-public-a2a-settlement",request:{network:ARC_MAINNET_PROFILE.networkId},startedAt:null});
  expect(native.prepare("SELECT count(*) AS n FROM hosted_treasury_authorizations").get()?.n).toBe(0);
  const health=await (await import("../../app/api/health/route")).GET();expect(health.status).toBe(200);
  expect(await health.json()).toMatchObject({network:"arc",settles:"real",paymentAuthority:{caller:"owner-consent",hosted:"sealed-policy-admission",availability:"not-probed"}});
},30000);


it("quotes and admits normal private mainnet research with independently checked dedicated custody and retained original settlement",async()=> {
  const {privateKeyToAccount}=await import("viem/accounts"),buyer=privateKeyToAccount(`0x${"11".repeat(32)}`),publicAccount=privateKeyToAccount(`0x${"77".repeat(32)}`),privateAccount=privateKeyToAccount(`0x${"88".repeat(32)}`);
  const seller=`0x${"33".repeat(20)}`,privatePayee=`0x${"aa".repeat(20)}`;
  vi.stubEnv("SELLER_ADDRESS",seller);vi.stubEnv("KERYX_PRIVATE_RESEARCH_RESERVED_PAYEES",privatePayee);vi.stubEnv("AGENT_FUNDER_PRIVATE_KEY","");vi.stubEnv("BUYER_PRIVATE_KEY","");
  const {adapter,file,identity}=await fixture(),root=mkdtempSync(join(tmpdir(),"keryx-native-mainnet-private-"));cleanup.push(()=>rmSync(root,{recursive:true,force:true}));
  const {storageIdentityDigest}=await import("./storage-identity"),{hostedTreasuryPolicyDigest}=await import("../payments/hosted-treasury-policy");
  const policy={format:"keryx-hosted-treasury-policy-v1" as const,network:"eip155:5042" as const,storageIdentityDigest:storageIdentityDigest(identity),origin:"https://keryx.cc",
    signer:publicAccount.address.toLowerCase(),lifetimeCapMicroUsdc:"1000000",queryCapMicroUsdc:"100000",expiresAtSeconds:Math.floor(Date.now()/1000)+3600};
  const privatePolicy={...policy,signer:privateAccount.address.toLowerCase()};
  vi.stubEnv("KERYX_MAINNET_TREASURY_POLICY_JSON",canonicalJson(policy));vi.stubEnv("KERYX_MAINNET_TREASURY_POLICY_DIGEST",hostedTreasuryPolicyDigest(policy));
  vi.stubEnv("KERYX_MAINNET_PRIVATE_TREASURY_POLICY_JSON",canonicalJson(privatePolicy));vi.stubEnv("KERYX_MAINNET_PRIVATE_TREASURY_POLICY_DIGEST",hostedTreasuryPolicyDigest(privatePolicy));
  const commit="ab".repeat(20),env={KERYX_PRIVATE_RESEARCH_ENABLED:"1",KERYX_PRIVATE_PURCHASE_ENABLED:"1",KERYX_PRIVATE_TREASURY_ADDRESS:privatePolicy.signer,
    KERYX_PRIVATE_TREASURY_CAPACITY_MICROS:"100000",KERYX_PRIVATE_RESEARCH_PAYEE:privatePayee,KERYX_PRIVATE_SERVICE_FEE_MICROS:"20000",KERYX_PRIVATE_MODEL_ID:"deepseek-flash",
    KERYX_PRIVATE_PROVIDER:"deepseek",KERYX_PRIVATE_PROVIDER_BASE_URL:"https://synthetic.example/v1",KERYX_PRIVATE_PROVIDER_API_KEY:"synthetic-private-provider-no-funds",
    KERYX_PRIVATE_APPROVED_ENDPOINTS:'["https://synthetic.example/v1/chat/completions"]',KERYX_PRIVATE_RESULT_SPOOL_DIRECTORY:root,KERYX_COMMIT:commit};
  for(const [name,value] of Object.entries(env))vi.stubEnv(name,value);
  const context={network:ARC_MAINNET_PROFILE.networkId,publicSeller:seller,publicTreasurySigners:[policy.signer],privateTreasurySigner:privatePolicy.signer};
  const runtimePolicy=(await import("../a2a/private-runtime-policy")).privateRuntimePolicy(process.env,context)!;
  const configurationId=(await import("../a2a/private-worker-configuration")).privateWorkerConfigurationId(runtimePolicy);
  await (await import("../a2a/private-worker-status")).privateWorkerStatusWriter(root,commit,configurationId)("idle");
  const calls:string[]=[];let originalId:string|undefined;const native=new DatabaseSync(file);cleanup.push(()=>native.close());
  vi.stubGlobal("fetch",vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
    const target=String(url),body=JSON.parse(String(init?.body));
    if(target.endsWith("/v1/balances")) return Response.json({token:"USDC",balances:[{depositor:body.sources[0].depositor,domain:26,balance:"1"}]});
    if(target===ARC_MAINNET_PROFILE.rpcUrl || target===ARC_MAINNET_PROFILE.rpcUrl+'/')return Response.json({jsonrpc:"2.0",id:body.id,result:"0x13b2"});
    if(target.startsWith(ARC_MAINNET_PROFILE.gatewayApiUrl) && target.endsWith("/verify")){calls.push("verify");expect(String(init?.body)).not.toContain("Private original source marker");return Response.json({isValid:true,payer:buyer.address});}
    if(target.startsWith(ARC_MAINNET_PROFILE.gatewayApiUrl) && target.endsWith("/settle")){
      expect(await adapter.getPrivatePaymentState(originalId!,buyer.address)).toMatchObject({status:"pending"});
      calls.push("settle");return Response.json({success:true,payer:buyer.address,network:ARC_MAINNET_PROFILE.networkId,transaction:"synthetic-private-mainnet-settlement"});
    }
    throw new Error("Unexpected synthetic private mainnet transport");
  }));
  const input={question:"Private original source marker",budget:0.03,researchMode:"quick",packageVersion:"1.0.0",responseMode:"async"};
  const quote=(await import("../a2a/private-quote-bootstrap")).privateQuoteBootstrap(adapter)!.quote(input);
  expect(quote.requirement.network).toBe(ARC_MAINNET_PROFILE.networkId);expect(quote.requirement.maxTimeoutSeconds).toBe(691200);expect(globalThis.fetch).not.toHaveBeenCalled();
  const bootstrap=(await import("../a2a/private-purchase-bootstrap")).privatePurchaseBootstrap,signal=new AbortController().signal;
  vi.stubEnv("KERYX_MAINNET_PRIVATE_TREASURY_PRIVATE_KEY",`0x${"44".repeat(32)}`);
  expect(await bootstrap(adapter,signal,buyer.address)).toBeNull();expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(await adapter.getPrivateTreasurySummary(privatePolicy.signer)).toBeNull();
  vi.stubEnv("KERYX_MAINNET_PRIVATE_TREASURY_PRIVATE_KEY",`0x${"88".repeat(32)}`);
  const service=await bootstrap(adapter,signal,buyer.address);expect(service).not.toBeNull();
  const {createPrivateAuthorization}=await import("../buyer/private-request-commitment"),protocol=await import("../buyer/protocol");
  const fresh=await createPrivateAuthorization(quote.request,quote.requirement,buyer.address,{privatePayee,publicResearchPayee:seller});
  const signature=await buyer.signTypedData(protocol.buyerTypedData(fresh.authorization));
  const submission={request:fresh.request,salt:fresh.salt,payment:{authorization:fresh.authorization,signature}};
  originalId=(await (await import("../a2a/private-research-intent")).preparePrivateResearchIntent(submission,quote.requirement,{privatePayee,publicResearchPayee:seller})).id;
  const result=await service!.submit(submission,buyer.address);expect(result.response).toEqual({id:originalId,paymentStatus:"settled"});
  expect(calls).toEqual(["verify","settle"]);
  expect((await service!.submit(submission,buyer.address)).response).toEqual(result.response);expect(calls).toEqual(["verify","settle"]);
  expect(await adapter.getPrivatePaymentState(originalId,buyer.address)).toMatchObject({status:"settled",confirmation:{network:ARC_MAINNET_PROFILE.networkId,transaction:"synthetic-private-mainnet-settlement"}});
  expect(await adapter.getPrivateTreasurySummary(privatePolicy.signer)).toMatchObject({allocatedMicros:"30000",unallocatedMicros:"70000"});
  expect(native.prepare("SELECT count(*) AS n FROM payment_events").get()?.n).toBe(0);
},60000);
