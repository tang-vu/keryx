import { encodeFunctionData, type Hex } from "viem";
import { z } from "zod";
import { config } from "../config";
import { ARC_MAINNET_PROFILE } from "../arc-network-profile";
import type { KeryxDB } from "../db/keryx-db";
import { canonicalJson } from "../canonical-json";
import { configuredSessionCashoutMaxAheadBlocks } from "../session/browser-session-cashout-policy";
import { withdrawPolicySchema, withdrawRequestSchema } from "./withdraw-protocol";
import { createWithdrawalRequest, type WithdrawalRequestRecord } from "./withdrawal-request";
import { getGatewayAvailableAtomic } from "./gateway-balance";
import { withdrawalHeightWindowForRpc } from "./withdrawal-height-window";
import { submitWithdrawalTransfer, requestCircleWithdrawalTransfer, withdrawalTransferProgress } from "./withdrawal-transfer-service";
import { withdrawalMintObserverForRpc, WITHDRAWAL_MINTER_ABI } from "./withdrawal-mint-observation";
import { observeWithdrawalOwnerCompletion } from "./withdrawal-owner-completion-observer";
import { verifyCreatorOwnerWithdrawalCompletion } from "./creator-owner-withdrawal-protocol";

const integer=z.string().regex(/^(0|[1-9][0-9]{0,15})$/).refine(v=>BigInt(v)<=BigInt(Number.MAX_SAFE_INTEGER));
/** Selected public creator authority needs no relay, treasury key or funding engine. */
export function creatorOwnerWithdrawalPolicy() {
  if(config.profile!==ARC_MAINNET_PROFILE || process.env.KERYX_FORCE_OFFLINE==="1") throw new Error("Owner withdrawal rail unavailable");
  return {limits: {domain:ARC_MAINNET_PROFILE.cctpDomain,gatewayWallet:ARC_MAINNET_PROFILE.gatewayWallet,
    gatewayMinter:ARC_MAINNET_PROFILE.gatewayMinter,asset:ARC_MAINNET_PROFILE.usdcAddress,
    maxValueMicros:integer.refine(v=>BigInt(v)>BigInt(0)).parse(process.env.KERYX_WITHDRAWAL_MAX_VALUE_MICROS),
    maxFeeMicros:integer.parse(process.env.KERYX_WITHDRAWAL_MAX_FEE_MICROS)},
    heightLimits:{maxAheadBlocks:configuredSessionCashoutMaxAheadBlocks(),maxProcessingLagBlocks:integer.parse(process.env.KERYX_WITHDRAWAL_MAX_PROCESSING_LAG_BLOCKS)}};
}
async function checkCurrentHeight(record:WithdrawalRequestRecord,signal:AbortSignal) {
  const selected=creatorOwnerWithdrawalPolicy(), window=await withdrawalHeightWindowForRpc(config.rpcUrl,record.policy,selected.heightLimits,signal,ARC_MAINNET_PROFILE);
  const height=BigInt(record.request.burnIntent.maxBlockHeight);
  if(height<BigInt(window.minimumBlockHeight)||height>BigInt(window.maximumBlockHeight)) throw new Error("Original owner expiry refused");
}
export async function creatorOwnerWithdrawalStatus(db:KeryxDB,owner:string,id:string,signal:AbortSignal) {
  if(config.profile!==ARC_MAINNET_PROFILE) throw new Error("Owner withdrawal rail unavailable");
  const record=await db.getCreatorWithdrawal(id,owner); if(!record) return null;
  if(record.network!==ARC_MAINNET_PROFILE.networkId || record.owner!==owner || record.policy.recipient!==owner) throw new Error("Original owner withdrawal refused");
  const progress=await withdrawalTransferProgress(db,id,owner),attestation=await db.getCreatorWithdrawalAttestation(id,owner),completion=await db.getCreatorOwnerWithdrawalCompletion(id,owner);
  let mint=null;
  if(attestation && !completion) {
    const observation=await withdrawalMintObserverForRpc(config.rpcUrl)(record,attestation,owner,signal);
    if(observation) mint={to:record.policy.gatewayMinter,data:encodeFunctionData({abi:WITHDRAWAL_MINTER_ABI,functionName:"gatewayMint",
      args:[attestation.attestation,attestation.signature]}),value:"0",network:record.network,observation};
  }
  return {wallet:owner,record,progress:{...progress,status:completion?"mint-finalized-observed":progress!.status,
    chainFinalityVerified:!!completion,retryAuthorized:false as const},attestation,mint,completion};
}
export async function submitCreatorOwnerWithdrawal(db:KeryxDB,owner:string,input:unknown,signal:AbortSignal,requireSession:()=>Promise<void>=async()=>signal.throwIfAborted()) {
  const selected=creatorOwnerWithdrawalPolicy(),request=withdrawRequestSchema.parse(input);
  const record=await createWithdrawalRequest(request,withdrawPolicySchema.parse({...selected.limits,owner,recipient:owner,
    maxValueMicros:request.burnIntent.spec.value}),ARC_MAINNET_PROFILE);
  if(BigInt(record.request.burnIntent.spec.value)>BigInt(selected.limits.maxValueMicros)) throw new Error("Owner withdrawal value refused");
  const prior=await db.getCreatorWithdrawal(record.id,owner);
  if(prior) {
    if(canonicalJson(prior)!==canonicalJson(record)) throw new Error("Original owner withdrawal conflict");
    return creatorOwnerWithdrawalStatus(db,owner,record.id,signal); // Recovery never sends a second burn.
  }
  const before=await db.creatorOwnerWithdrawalAccounting(owner),available=await getGatewayAvailableAtomic(owner,ARC_MAINNET_PROFILE);
  if(available===null || available>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Owner withdrawal known balance unavailable");
  await checkCurrentHeight(record,signal); signal.throwIfAborted();
  await requireSession();
  await db.admitCreatorOwnerWithdrawal(record,before,String(available));
  await submitWithdrawalTransfer(db,record,owner,async(original,current)=>{await requireSession();await checkCurrentHeight(original,current);await requireSession();},
    async(original,current)=>{await requireSession();return requestCircleWithdrawalTransfer(original,current);},signal);
  return creatorOwnerWithdrawalStatus(db,owner,record.id,signal);
}
export async function completeCreatorOwnerWithdrawal(db:KeryxDB,owner:string,id:string,hash:Hex,signal:AbortSignal) {
  if(config.profile!==ARC_MAINNET_PROFILE) throw new Error("Owner withdrawal rail unavailable");
  const record=await db.getCreatorWithdrawal(id,owner); if(!record) return null;
  const prior=await db.getCreatorOwnerWithdrawalCompletion(id,owner);
  if(prior) {
    if(prior.observation.transactionHash!==hash) throw new Error("Original owner mint conflict");
    return creatorOwnerWithdrawalStatus(db,owner,id,signal);
  }
  const attestation=await db.getCreatorWithdrawalAttestation(id,owner); if(!attestation) throw new Error("Original owner attestation unavailable");
  const proof=await observeWithdrawalOwnerCompletion(record,attestation,owner,hash,config.rpcUrl,signal);
  const completion=await verifyCreatorOwnerWithdrawalCompletion({format:"keryx-creator-owner-withdrawal-completion-v1",network:record.network,
    requestId:id,ownerAddr:owner,...proof});
  await db.recordWithdrawal({txHash:hash,createdAt:completion.observation.observedAt,label:"creator",wallet:owner,recipient:owner,
    amountUsdc:Number(record.request.burnIntent.spec.value)/1e6,network:record.network});
  await db.completeCreatorOwnerWithdrawal(completion);
  return creatorOwnerWithdrawalStatus(db,owner,id,signal);
}
