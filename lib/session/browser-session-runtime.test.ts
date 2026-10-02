import { expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress, type Hex } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { createSessionGrantConsentMessage } from "../payments/session-grant-consent";
import { createBrowserSessionKey, type RetainedSessionStore } from "./browser-session-key";
import { createBrowserSessionRuntime } from "./browser-session-runtime";
import type { IsolatedWrappedKey, WrappingKeyStore } from "./isolated-session-vault";

async function fixture() {
  const owner = privateKeyToAccount(`0x${"11".repeat(32)}`), payout = privateKeyToAccount(`0x${"22".repeat(32)}`).address.toLowerCase();
  const keys = new Map<string, CryptoKey>(), blobs = new Map<string, IsolatedWrappedKey>();
  const wrappingKeys: WrappingKeyStore = { async getOrCreate(n, k) { if (!keys.has(n)) keys.set(n,k); return keys.get(n)!; }, async destroy() { throw new Error(); } };
  const retained: RetainedSessionStore = { async read(n) { return blobs.get(n) ?? null; }, async retain(n,b) { if (!blobs.has(n)) blobs.set(n,b); return blobs.get(n)!; } };
  const key = createBrowserSessionKey("https://keryx.cc",owner.address,{wrappingKeys,retained});
  await key.derive(await owner.signMessage({message:key.context.derivationMessage}));
  const consent = { format: "keryx-session-grant-consent-v1" as const, network: profile.networkId, origin:key.context.origin,
    ownerAddr:key.context.owner,sessAddr:key.address!.toLowerCase(),grantEpoch:"00000000-0000-4000-8000-000000000001",
    capMicroUsdc:"2000",expirySeconds:String(Math.floor(Date.now()/1000)+3600) };
  const grant = { active:true,sessionId:key.context.owner,ownerAddr:key.context.owner,sessAddr:consent.sessAddr,
    grantEpoch:consent.grantEpoch,network:profile.networkId,origin:key.context.origin,capMicroUsdc:consent.capMicroUsdc,spentMicroUsdc:"0",consent,
    ownerSignature:await owner.signMessage({message:createSessionGrantConsentMessage(consent,profile)}) };
  const provedGrant = { ...grant, sessionSignature: await key.signGrantConsentProof(consent, grant.ownerSignature) };
  const challenge = { sessionId:key.context.owner,reqId:"00000000-0000-4000-8000-000000000002",grantEpoch:consent.grantEpoch,
    sessAddr:consent.sessAddr,sourceId:"publication",kind:"fetch",expectedNonce:`0x${"33".repeat(32)}`,browserAuthorizationProtocol:"durable-v1",
    requirements:{scheme:"exact",network:profile.networkId,asset:profile.usdcAddress,amount:"1000",payTo:payout,maxTimeoutSeconds:604900,
      extra:{name:"GatewayWalletBatched",version:"1",verifyingContract:profile.gatewayWallet}},
    paymentContext:{item:{itemId:"article",itemTitle:"Actual reviewed article",itemUrl:"https://source.test/article",contentVersion:`sha256:${"44".repeat(32)}`}} };
  const questions = new Map<string, { cap: string; total: bigint }>(); const question = { id: "00000000-0000-4000-8000-000000000003", budgetMicroUsdc: "2000" }; const consumed = new Set<string>(); let total = BigInt(0), revoked = false;
  const dependencies = {
    async json(path:string): Promise<unknown> { if (revoked) throw new Error("revoked"); if(path === "/api/session/grant") return structuredClone(provedGrant);
      if(path === "/api/ask/challenge") return structuredClone(challenge);
      if(path === "/api/sources") return {sources:[{id:"publication",onchainId:`0x${"55".repeat(32)}`} ]};
      if(path.includes("/item/article/preview?")) return {sourceId: "publication", item: structuredClone(challenge.paymentContext.item), payTo: payout, listPriceMicroUsdc: "1000"};
      throw new Error(path); },
    async readSource() { return {fetchPayTo:payout,creator:payout,wallets:new Set([payout]),listPriceUsdc:0.001,onchain:true,active:true}; },
    async reserve(_n:string,_e:string,nonce:string,value:bigint,cap:bigint,scope:typeof question) { const previous=questions.get(scope.id); if(consumed.has(nonce)||total+value>cap||(previous&&previous.cap!==scope.budgetMicroUsdc)||(previous?.total??BigInt(0))+value>BigInt(scope.budgetMicroUsdc)) throw new Error("retained capacity"); consumed.add(nonce); total+=value; questions.set(scope.id,{cap:scope.budgetMicroUsdc,total:(previous?.total??BigInt(0))+value}); },
  };
  return {owner,key,question,grant:provedGrant,challenge,dependencies,consumed,revoke(){revoked=true;}};
}
it("signs the authenticated original with real mainnet EOA cryptography and retains nonce exposure across reload",async()=>{
  const f=await fixture(),runtime=createBrowserSessionRuntime(f.key,f.dependencies);
  const {paymentHeader}=await runtime.authorizePayment(f.challenge.reqId, f.question);
  const body=JSON.parse(atob(paymentHeader)) as {signature:Hex;authorization:Record<string,string>};
  expect(body.authorization.nonce).toBe(f.challenge.expectedNonce);
  expect((await recoverTypedDataAddress({domain:{name:"GatewayWalletBatched",version:"1",chainId:profile.chainId,verifyingContract:profile.gatewayWallet},
    types:{TransferWithAuthorization:[{name:"from",type:"address"},{name:"to",type:"address"},{name:"value",type:"uint256"},
      {name:"validAfter",type:"uint256"},{name:"validBefore",type:"uint256"},{name:"nonce",type:"bytes32"}]},primaryType:"TransferWithAuthorization",
    message:{from:body.authorization.from as Hex,to:body.authorization.to as Hex,value:BigInt(body.authorization.value),
      validAfter:BigInt(body.authorization.validAfter),validBefore:BigInt(body.authorization.validBefore),nonce:body.authorization.nonce as Hex},signature:body.signature})).toLowerCase()).toBe(f.key.address!.toLowerCase());
  runtime.lock();await f.key.restore();
  await expect(createBrowserSessionRuntime(f.key,f.dependencies).authorizePayment(f.challenge.reqId, f.question)).rejects.toThrow("retained capacity");
  f.grant.consent.expirySeconds="1";
  f.grant.ownerSignature=await f.owner.signMessage({message:createSessionGrantConsentMessage(f.grant.consent,profile)});
  await expect(runtime.bindGrant()).rejects.toThrow("Browser payment authorization refused");
  runtime.lock();expect((await f.key.restore()).address).toBeTruthy();
});
it("refuses owner-consent substitution, wrong chain, wrong payout and unpriced content before exposure",async()=>{
  for(const mutate of [(f:Awaited<ReturnType<typeof fixture>>)=>{f.grant.capMicroUsdc="9000";},
    (f:Awaited<ReturnType<typeof fixture>>)=>{f.challenge.requirements.network="eip155:5042002" as typeof profile.networkId;},
    (f:Awaited<ReturnType<typeof fixture>>)=>{f.challenge.requirements.payTo=f.owner.address;},
    (f:Awaited<ReturnType<typeof fixture>>)=>{f.challenge.requirements.amount="999";}]){
    const f=await fixture();mutate(f);
    await expect(createBrowserSessionRuntime(f.key,f.dependencies).authorizePayment(f.challenge.reqId, f.question)).rejects.toThrow();
    expect(f.consumed.size).toBe(0);
  }
});
it("retains capacity but suppresses header publication when another tab revokes during cryptography",async()=>{
  const f=await fixture();let release!:()=>void,entered!:()=>void;
  const pending=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
  const delayed={...f.key,signPayment:async(...args:Parameters<typeof f.key.signPayment>)=>{entered();await pending;return f.key.signPayment(...args);}};
  const operation=createBrowserSessionRuntime(delayed,f.dependencies).authorizePayment(f.challenge.reqId, f.question);
  await started;f.revoke();release();await expect(operation).rejects.toThrow("revoked");
  expect(f.consumed.size).toBe(1);
});
it("refuses changed item identity, receipt or independently priced metadata before signing", async () => {
  for (const patch of [{ item: { itemId: "article", contentVersion: `sha256:${"99".repeat(32)}` } },
    { listPriceMicroUsdc: "999" }, { payTo: `0x${"99".repeat(20)}` }]) {
    const f = await fixture(), original = f.dependencies.json;
    f.dependencies.json = async path => { const body = await original(path); return path.includes("/preview?") ? { ...(body as Record<string, unknown>), ...patch } : body; };
    await expect(createBrowserSessionRuntime(f.key, f.dependencies).authorizePayment(f.challenge.reqId, f.question)).rejects.toThrow();
    expect(f.consumed.size).toBe(0);
  }
});

it("enforces a question's integer sum independently of a larger lifetime grant", async () => {
  const f = await fixture();
  f.grant.capMicroUsdc = f.grant.consent.capMicroUsdc = "500000";
  f.grant.ownerSignature = await f.owner.signMessage({ message: createSessionGrantConsentMessage(f.grant.consent, profile) });
  f.grant.sessionSignature = await f.key.signGrantConsentProof(f.grant.consent, f.grant.ownerSignature);
  const runtime = createBrowserSessionRuntime(f.key, f.dependencies);
  const scope = { id: f.question.id, budgetMicroUsdc: "10000" };
  f.challenge.kind = "citation";
  delete (f.challenge as { paymentContext?: unknown }).paymentContext;
  f.challenge.requirements.amount = "11000";
  await expect(runtime.authorizePayment(f.challenge.reqId, scope)).rejects.toThrow("retained capacity");
  expect(f.consumed.size).toBe(0);
  f.challenge.requirements.amount = "6000";
  await runtime.authorizePayment(f.challenge.reqId, scope);
  f.challenge.expectedNonce = `0x${"77".repeat(32)}`;
  f.challenge.requirements.amount = "4000";
  await runtime.authorizePayment(f.challenge.reqId, scope);
  f.challenge.expectedNonce = `0x${"88".repeat(32)}`;
  f.challenge.requirements.amount = "1";
  await expect(createBrowserSessionRuntime(f.key, f.dependencies).authorizePayment(f.challenge.reqId, scope)).rejects.toThrow("retained capacity");
  await expect(runtime.authorizePayment(f.challenge.reqId, { ...scope, budgetMicroUsdc: "500000" })).rejects.toThrow("retained capacity");
  expect(f.consumed.size).toBe(2);
});

it("accepts a same-epoch retained spend increase while keeping immutable consent checks", async () => {
  const f = await fixture(), originalSource = f.dependencies.readSource;
  f.dependencies.readSource = async () => { f.grant.spentMicroUsdc = "500"; return originalSource(); };
  const key = { ...f.key, signPayment: async (...args: Parameters<typeof f.key.signPayment>) => {
    const signature = await f.key.signPayment(...args); f.grant.spentMicroUsdc = "1500"; return signature;
  } };
  expect((await createBrowserSessionRuntime(key, f.dependencies).authorizePayment(f.challenge.reqId, f.question)).paymentHeader).toBeTruthy();
  expect(f.consumed.size).toBe(1);
});
