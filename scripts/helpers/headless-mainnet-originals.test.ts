import { expect,it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_PROFILE as profile } from "../../lib/arc-network-profile";
import { browserSessionCustodyContext } from "../../lib/session/browser-session-custody";
import { createSessionGrantConsentMessage,createSessionGrantSignerProofMessage } from "../../lib/payments/session-grant-consent";
import { inspectHeadlessOriginal } from "./headless-mainnet-originals.mjs";
async function fixture(){
  const owner=privateKeyToAccount(`0x${"11".repeat(32)}`),session=privateKeyToAccount(`0x${"22".repeat(32)}`);
  const context=browserSessionCustodyContext(profile,"https://keryx.cc",owner.address),epoch="00000000-0000-4000-8000-000000000001",
    reqId="00000000-0000-4000-8000-000000000002",nonce=`0x${"33".repeat(32)}`;
  const consent={format:"keryx-session-grant-consent-v1",network:profile.networkId,origin:context.origin,ownerAddr:context.owner,
    sessAddr:session.address.toLowerCase(),grantEpoch:epoch,capMicroUsdc:"2000",expirySeconds:String(Math.floor(Date.now()/1000)-100)};
  const expected={context,signer:session.address,reqId,nonce,epoch,amount:"1000",cap:"2000"};
  const response={journal:{requestId:reqId,sessionId:context.owner,grantEpoch:epoch,signer:session.address.toLowerCase(),nonce,phase:"settled",
    requirements:{scheme:"exact",network:profile.networkId,asset:profile.usdcAddress,amount:"1000",payTo:owner.address,maxTimeoutSeconds:604900,
      extra:{name:"GatewayWalletBatched",version:"1",verifyingContract:profile.gatewayWallet}},
    payment:{authorizationId:nonce,network:profile.networkId,settled:true,settlementStatus:"settled",amountUsdc:0.001,txHash:"synthetic-recorded-proof-not-live-settlement"}},
    authorization:{consent,ownerSignature:await owner.signMessage({message:createSessionGrantConsentMessage(consent,profile)}),
      sessionSignature:await session.signMessage({message:createSessionGrantSignerProofMessage(consent,profile)})},
    settlementConfirmed:true,statusAuthority:"retained-journal-only",retryAuthorized:false};
  return{expected,response};
}
it("reads a cryptographically bound expired original without granting another signature",async()=>{
  const f=await fixture();expect(await inspectHeadlessOriginal(f.response,f.expected)).toMatchObject({settlementConfirmed:true,retryAuthorized:false,network:profile.networkId});
});
it("keeps signed but unconfirmed originals uncertain",async()=>{
  const f=await fixture();f.response.journal.phase="signed";f.response.journal.payment.settled=false;f.response.journal.payment.settlementStatus="pending";
  f.response.settlementConfirmed=false;expect(await inspectHeadlessOriginal(f.response,f.expected)).toMatchObject({settlementConfirmed:false,retryAuthorized:false});
});
it.each(["network","nonce","epoch","amount","missing-proof","grant-cap","retry"])("refuses original %s mismatch before releasing the local hold",async kind=>{
  const f=await fixture();
  if(kind==="network")f.response.journal.payment.network="eip155:5042002" as typeof profile.networkId;
  if(kind==="nonce")f.response.journal.nonce=`0x${"44".repeat(32)}`;
  if(kind==="epoch")f.response.journal.grantEpoch="00000000-0000-4000-8000-000000000004";
  if(kind==="amount")f.response.journal.requirements.amount="999";
  if(kind==="missing-proof")f.response.journal.payment.txHash="";
  if(kind==="grant-cap")f.response.authorization.consent.capMicroUsdc="9000";
  if(kind==="retry")f.response.retryAuthorized=true;
  await expect(inspectHeadlessOriginal(f.response,f.expected)).rejects.toThrow();
});
