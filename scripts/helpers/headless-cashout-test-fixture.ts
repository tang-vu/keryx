import { concatHex,encodeFunctionData,hashTypedData,keccak256,type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARC_MAINNET_PROFILE as profile } from "../../lib/arc-network-profile";
import { createBrowserSessionKey } from "../../lib/session/browser-session-key";
import { createSessionGrantConsentMessage,createSessionGrantSignerProofMessage } from "../../lib/payments/session-grant-consent";
import { prepareWithdrawIntentForProfile } from "../../lib/gateway/withdraw-intent-core";
import { withdrawPolicySchema,withdrawTypedData } from "../../lib/gateway/withdraw-protocol";
import type { SessionWithdrawalPreparation } from "../../lib/gateway/session-withdrawal-protocol";
import { createWithdrawalRequest } from "../../lib/gateway/withdrawal-request";
import { matchWithdrawalAttestation } from "../../lib/gateway/withdrawal-attestation";
import { matchWithdrawalMintTransaction } from "../../lib/gateway/withdrawal-mint-transaction";
import { WITHDRAWAL_MINTER_ABI } from "../../lib/gateway/withdrawal-mint-observation";
import { openHeadlessMainnetState } from "./headless-mainnet-state.mjs";
import { browserSessionCustodyContext } from "../../lib/session/browser-session-custody";

export const testHeadlessOwner=privateKeyToAccount(`0x${"11".repeat(32)}`),testHeadlessWrapping=`0x${"55".repeat(32)}`;
export const testHeadlessContext=browserSessionCustodyContext(profile,"https://keryx.cc",testHeadlessOwner.address);
export async function headlessCashoutFixture(directory:string){
  const state=await openHeadlessMainnetState(directory,testHeadlessContext,testHeadlessWrapping),key=createBrowserSessionKey(testHeadlessContext.origin,testHeadlessOwner.address,state);
  const derivation=await testHeadlessOwner.signMessage({message:key.context.derivationMessage});await key.derive(derivation);
  const signer=privateKeyToAccount(keccak256(concatHex([key.context.digest,derivation])));
  const consent={format:"keryx-session-grant-consent-v1" as const,network:profile.networkId,origin:key.context.origin,ownerAddr:key.context.owner,
    sessAddr:signer.address.toLowerCase(),grantEpoch:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",capMicroUsdc:"1000000",expirySeconds:"1"};
  const burnIntent={...prepareWithdrawIntentForProfile(profile,consent.sessAddr,"500000",consent.ownerAddr,"1000"),maxBlockHeight:"1100"};
  const p:SessionWithdrawalPreparation={format:"keryx-session-withdrawal-preparation-v1",network:profile.networkId,requestId:hashTypedData(withdrawTypedData(burnIntent)),
    ownerAddr:consent.ownerAddr,sessAddr:consent.sessAddr,grantEpoch:consent.grantEpoch,authorization:{consent,
      ownerSignature:await testHeadlessOwner.signMessage({message:createSessionGrantConsentMessage(consent,profile)}),
      sessionSignature:await signer.signMessage({message:createSessionGrantSignerProofMessage(consent,profile)})},burnIntent,
    policy:withdrawPolicySchema.parse({owner:consent.sessAddr,recipient:consent.ownerAddr,domain:profile.cctpDomain,gatewayWallet:profile.gatewayWallet,
      gatewayMinter:profile.gatewayMinter,asset:profile.usdcAddress,maxValueMicros:"500000",maxFeeMicros:"1000"}),
    balance:{availableMicroUsdc:"1000000",heldPaymentMicroUsdc:"0",heldWithdrawalMicroUsdc:"0",confirmedSpentMicroUsdc:"0",maxFeeMicroUsdc:"1000"},
    height:{minimumBlockHeight:"1100",maximumBlockHeight:"1200",observedBlockNumber:"1000",observedBlockHash:`0x${"55".repeat(32)}`,observedAt:new Date().toISOString()}};
  return {state,key,p,signer};
}
export async function headlessCashoutCompletion(p:SessionWithdrawalPreparation,signature:Hex){
  const record=await createWithdrawalRequest({burnIntent:p.burnIntent,signature},p.policy,profile),spec=record.request.burnIntent.spec;
  const encoded="ca85def7000000010000001a0000001a"+[spec.sourceContract,spec.destinationContract,spec.sourceToken,spec.destinationToken,
    spec.sourceDepositor,spec.destinationRecipient,spec.sourceSigner,spec.destinationCaller].map(v=>v.slice(2)).join("")+BigInt(spec.value).toString(16).padStart(64,"0")+spec.salt.slice(2)+"00000000";
  const payload=`0xff6fb334${BigInt(1200).toString(16).padStart(64,"0")}00000154${encoded}` as Hex,attester=privateKeyToAccount(`0x${"44".repeat(32)}`);
  const attestation=await matchWithdrawalAttestation(record,{transferId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",attestation:payload,expirationBlock:"1200",
    signature:await attester.signMessage({message:{raw:keccak256(payload)}})});
  const mint={to:profile.gatewayMinter.toLowerCase(),data:encodeFunctionData({abi:WITHDRAWAL_MINTER_ABI,functionName:"gatewayMint",args:[attestation.attestation,attestation.signature]}),
    value:"0" as const,nonce:7,gas:"50000",maxFeePerGas:"20",maxPriorityFeePerGas:"1"};
  const terms={relayer:p.ownerAddr as Hex,nonce:mint.nonce,gas:mint.gas,maxFeePerGas:mint.maxFeePerGas,maxPriorityFeePerGas:mint.maxPriorityFeePerGas,gasBudgetWei:"1000000"};
  const serializedTransaction=await testHeadlessOwner.signTransaction({type:"eip1559",chainId:profile.chainId,to:profile.gatewayMinter,data:mint.data,value:BigInt(0),
    nonce:mint.nonce,gas:BigInt(mint.gas),maxFeePerGas:BigInt(mint.maxFeePerGas),maxPriorityFeePerGas:BigInt(mint.maxPriorityFeePerGas)});
  const matched=await matchWithdrawalMintTransaction(record,attestation,serializedTransaction,terms);
  const completion={format:"keryx-session-withdrawal-completion-v1" as const,network:profile.networkId,requestId:p.requestId,ownerAddr:p.ownerAddr,sessAddr:p.sessAddr,
    record,attestation,serializedTransaction,terms,observation:{status:"mint-finalized-observed",authority:"arc-mainnet-rpc-finality",requestId:p.requestId,
      transactionHash:matched.transactionHash,transferSpecHash:matched.transferSpecHash,chainId:profile.chainId,blockNumber:"1101",blockHash:`0x${"66".repeat(32)}`,
      transactionIndex:0,logIndex:0,recipient:p.ownerAddr,amountMicros:spec.value,gasUsed:"40000",effectiveGasPriceWei:"10",gasCostWei:"400000",
      chainFinalityVerified:true,finalityBasis:"operator-selected-rpc",finalizedBlockNumber:"1102",finalizedBlockHash:`0x${"77".repeat(32)}`,observedAt:new Date().toISOString()}};
  return {mint,completion,hash:matched.transactionHash};
}
