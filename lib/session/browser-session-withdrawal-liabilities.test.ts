import { expect, it } from "vitest";
import { readBrowserSessionPaymentAccounting, readBrowserWithdrawalLiabilities } from "./browser-session-withdrawal-liabilities";
import { canonicalJson } from "../canonical-json";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import type { LocalSessionAuthorization } from "./browser-session-withdrawal-storage";
const owner=`0x${"11".repeat(20)}`, signer=`0x${"22".repeat(20)}`, payTo=`0x${"ab".repeat(20)}`;
const epoch="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", reqId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", nonce=`0x${"44".repeat(32)}`;
async function fixture() {
  const requirements = { scheme: "exact" as const, network: profile.networkId, amount: "500000", payTo,
    asset: profile.usdcAddress.toLowerCase(), maxTimeoutSeconds: 691200,
    extra: { name: "GatewayWalletBatched" as const, version: "1" as const, verifyingContract: profile.gatewayWallet.toLowerCase() } };
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonicalJson(requirements)))),n=>n.toString(16).padStart(2,"0")).join("");
  const local: LocalSessionAuthorization = { nonce, epoch, amount:"500000",requirementsDigest:digest,
    original:{sessionId:owner,sessAddr:signer,reqId,grantEpoch:epoch,sourceId:"source",kind:"citation",expectedNonce:nonce,
      browserAuthorizationProtocol:"durable-v1",requirements} };
  const journal={nonce,sessionId:owner,signer,requestId:reqId,grantEpoch:epoch,phase:"settled",requirements,signedHeaderHash:"55".repeat(32),
    payment:{authorizationId:nonce,payer:signer,payee:payTo,network:profile.networkId,sourceId:"source",kind:"citation",amountUsdc:0.5,settled:true,settlementStatus:"settled",txHash:"circle-original"}};
  const page=(p:unknown[])=>({network:profile.networkId,sessAddr:signer,retryAuthorized:false,payments:p,nextCursor:null});
  return {local,journal,page};
}
it("distinguishes original settled historical debit while retaining missing, unknown and legacy exposure",async()=>{
  const f=await fixture();
  expect(await readBrowserWithdrawalLiabilities([f.local],owner,signer,epoch,async()=>f.page([f.journal]))).toBe(BigInt(0));
  const upper=`0x${payTo.slice(2).toUpperCase()}`;
  expect(await readBrowserWithdrawalLiabilities([f.local],owner,signer,epoch,async()=>f.page([{...f.journal,
    requirements:{...f.journal.requirements,payTo:upper,extra:{...f.journal.requirements.extra,verifyingContract:profile.gatewayWallet}},
    payment:{...f.journal.payment,payee:upper}}]))).toBe(BigInt(0));
  for(const evidence of [[],[{...f.journal,phase:"signed"}],[{...f.journal,payment:{...f.journal.payment,settlementStatus:"simulated"}}]])
    expect(await readBrowserWithdrawalLiabilities([f.local],owner,signer,epoch,async()=>f.page(evidence))).toBe(BigInt(500000));
  expect(await readBrowserWithdrawalLiabilities([{nonce,epoch,amount:"500000"}],owner,signer,epoch,async()=>f.page([f.journal]))).toBe(BigInt(500000));
});
it("holds a claimed settlement with any changed original payer, payee, requirements or nonce tuple",async()=>{
  const f=await fixture();
  const changes=[{...f.journal,payment:{...f.journal.payment,payer:owner}},
    {...f.journal,payment:{...f.journal.payment,payee:owner}},
    {...f.journal,payment:{...f.journal.payment,network:"eip155:5042002"}},
    {...f.journal,requirements:{...f.journal.requirements,payTo:owner}},
    {...f.journal,requestId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"},
    {...f.journal,grantEpoch:"cccccccc-cccc-4ccc-8ccc-cccccccccccc"},
    {...f.journal,signedHeaderHash:undefined}];
  for(const changed of changes) expect(await readBrowserWithdrawalLiabilities([f.local],owner,signer,epoch,async()=>f.page([changed]))).toBe(BigInt(500000));
});

it("releases only exact original terminal-failed evidence, never a pending or mismatched failure", async () => {
  const f = await fixture();
  const failed = { ...f.journal, phase: "failed", payment: { ...f.journal.payment, settled: false, settlementStatus: "failed" } };
  const result = await readBrowserSessionPaymentAccounting([f.local], owner, signer, epoch, async () => f.page([failed]));
  expect(result.held).toBe(BigInt(0));
  expect(result.failures).toMatchObject([{ nonce, epoch, amount: "500000", transferId: "circle-original", original: f.local.original }]);
  expect(result.failures[0].evidenceDigest).toMatch(/^[0-9a-f]{64}$/);
  for (const change of [
    { ...failed, phase: "submission_attempted" },
    { ...failed, signedHeaderHash: undefined },
    { ...failed, payment: { ...failed.payment, settled: true } },
    { ...failed, payment: { ...failed.payment, txHash: null } },
    { ...failed, payment: { ...failed.payment, amountUsdc: 0.4 } },
    { ...failed, payment: { ...failed.payment, authorizationId: `0x${"77".repeat(32)}` } },
    { ...failed, payment: { ...failed.payment, payer: owner } },
    { ...failed, paymentContext: { item: { itemId: "different" } } },
    { ...failed, requirements: { ...failed.requirements, asset: owner } },
  ]) {
    expect(await readBrowserSessionPaymentAccounting([f.local], owner, signer, epoch, async () => f.page([change])))
      .toEqual({ held: BigInt(500000), failures: [] });
  }
});
