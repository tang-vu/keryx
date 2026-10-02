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
    grantEpoch:consent.grantEpoch,network:profile.networkId,origin:key.context.origin,capMicroUsdc:consent.capMicroUsdc,consent,
    ownerSignature:await owner.signMessage({message:createSessionGrantConsentMessage(consent,profile)}) };
  const provedGrant = { ...grant, sessionSignature: await key.signGrantConsentProof(consent, grant.ownerSignature) };
  const challenge = { sessionId:key.context.owner,reqId:"00000000-0000-4000-8000-000000000002",grantEpoch:consent.grantEpoch,
    sessAddr:consent.sessAddr,sourceId:"publication",kind:"fetch",expectedNonce:`0x${"33".repeat(32)}`,browserAuthorizationProtocol:"durable-v1",
    requirements:{scheme:"exact",network:profile.networkId,asset:profile.usdcAddress,amount:"1000",payTo:payout,maxTimeoutSeconds:604900,
      extra:{name:"GatewayWalletBatched",version:"1",verifyingContract:profile.gatewayWallet}},
    paymentContext:{item:{itemId:"article",itemTitle:"Actual reviewed article",itemUrl:"https://source.test/article",contentVersion:`sha256:${"44".repeat(32)}`}} };
  const consumed = new Set<string>(); let total = BigInt(0), revoked = false;
  const dependencies = {
    async json(path:string) { if (revoked) throw new Error("revoked"); if(path === "/api/session/grant") return structuredClone(provedGrant);
      if(path === "/api/ask/challenge") return structuredClone(challenge);
      if(path === "/api/sources") return {sources:[{id:"publication",onchainId:`0x${"55".repeat(32)}`} ]}; throw new Error(path); },
    async readSource() { return {fetchPayTo:payout,creator:payout,wallets:new Set([payout]),listPriceUsdc:0.001,onchain:true,active:true}; },
    async reserve(_n:string,_e:string,nonce:string,value:bigint,cap:bigint) { if(consumed.has(nonce)||total+value>cap) throw new Error("retained capacity"); consumed.add(nonce); total+=value; },
  };
  return {owner,key,grant:provedGrant,challenge,dependencies,consumed,revoke(){revoked=true;}};
}
it("signs the authenticated original with real mainnet EOA cryptography and retains nonce exposure across reload",async()=>{
  const f=await fixture(),runtime=createBrowserSessionRuntime(f.key,f.dependencies);
  const {paymentHeader}=await runtime.authorizePayment(f.challenge.reqId);
  const body=JSON.parse(atob(paymentHeader)) as {signature:Hex;authorization:Record<string,string>};
  expect(body.authorization.nonce).toBe(f.challenge.expectedNonce);
  expect((await recoverTypedDataAddress({domain:{name:"GatewayWalletBatched",version:"1",chainId:profile.chainId,verifyingContract:profile.gatewayWallet},
    types:{TransferWithAuthorization:[{name:"from",type:"address"},{name:"to",type:"address"},{name:"value",type:"uint256"},
      {name:"validAfter",type:"uint256"},{name:"validBefore",type:"uint256"},{name:"nonce",type:"bytes32"}]},primaryType:"TransferWithAuthorization",
    message:{from:body.authorization.from as Hex,to:body.authorization.to as Hex,value:BigInt(body.authorization.value),
      validAfter:BigInt(body.authorization.validAfter),validBefore:BigInt(body.authorization.validBefore),nonce:body.authorization.nonce as Hex},signature:body.signature})).toLowerCase()).toBe(f.key.address!.toLowerCase());
  runtime.lock();await f.key.restore();
  await expect(createBrowserSessionRuntime(f.key,f.dependencies).authorizePayment(f.challenge.reqId)).rejects.toThrow("retained capacity");
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
    await expect(createBrowserSessionRuntime(f.key,f.dependencies).authorizePayment(f.challenge.reqId)).rejects.toThrow();
    expect(f.consumed.size).toBe(0);
  }
});
it("retains capacity but suppresses header publication when another tab revokes during cryptography",async()=>{
  const f=await fixture();let release!:()=>void,entered!:()=>void;
  const pending=new Promise<void>(r=>{release=r;}),started=new Promise<void>(r=>{entered=r;});
  const delayed={...f.key,signPayment:async(...args:Parameters<typeof f.key.signPayment>)=>{entered();await pending;return f.key.signPayment(...args);}};
  const operation=createBrowserSessionRuntime(delayed,f.dependencies).authorizePayment(f.challenge.reqId);
  await started;f.revoke();release();await expect(operation).rejects.toThrow("revoked");
  expect(f.consumed.size).toBe(1);
});
