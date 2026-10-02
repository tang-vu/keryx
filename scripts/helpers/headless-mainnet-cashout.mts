import { createPublicClient } from "viem";
import { z } from "zod";
import { ARC_MAINNET_PROFILE as profile } from "../../lib/arc-network-profile";
import { chainForProfile } from "../../lib/chains";
import { withdrawalRpcTransport } from "../../lib/gateway/withdrawal-rpc-transport";
import { createWithdrawalRequest } from "../../lib/gateway/withdrawal-request";
import { prepareWithdrawalOwnerWalletMint } from "../../lib/gateway/withdrawal-owner-wallet-mint";
import { verifySessionWithdrawalPreparation } from "../../lib/gateway/session-withdrawal-protocol";
import { createBrowserSessionWithdrawalRuntime, type SessionWithdrawalRuntimeKey } from "../../lib/session/browser-session-withdrawal-runtime";
import type { openHeadlessMainnetState } from "./headless-mainnet-state.mjs";

const refuse=():never=>{throw new Error("Original headless cashout unavailable; preserve custody and original attempts");};
const hash=z.string().regex(/^0x[0-9a-f]{64}$/),micros=z.string().regex(/^(0|[1-9]\d{0,15})$/).refine(v=>BigInt(v)<=BigInt(Number.MAX_SAFE_INTEGER));
export type HeadlessCashoutPorts = Pick<Parameters<typeof createBrowserSessionWithdrawalRuntime>[1],"chain"|"completion"> & { prepareMint?: typeof prepareWithdrawalOwnerWalletMint };
export function validateHeadlessCashoutArgs(args:string[]){
  if(args[0]==="withdraw-prepare")return z.tuple([z.literal("withdraw-prepare"),z.string().uuid(),micros.refine(v=>BigInt(v)>BigInt(0)),micros]).parse(args);
  if(args[0]==="withdraw-sign")return z.tuple([z.literal("withdraw-sign"),hash,micros.refine(v=>BigInt(v)>BigInt(0)),micros]).parse(args);
  if(args[0]==="withdraw-complete")return z.tuple([z.literal("withdraw-complete"),hash,hash]).parse(args);
  return z.tuple([z.enum(["withdraw-status","withdraw-submit","withdraw-cancel","withdraw-mint","withdraw-recover"]),hash]).parse(args);
}

/** No raw transaction signer. Every operation selects an original retained ID;
 * owner gas authority is delivered only as an unsigned, durably claimed handoff. */
export async function runHeadlessCashout(args:string[],key:SessionWithdrawalRuntimeKey,state:Awaited<ReturnType<typeof openHeadlessMainnetState>>,
  json:(path:string,method?:string,body?:unknown)=>Promise<unknown>,ports:HeadlessCashoutPorts={}){
  validateHeadlessCashoutArgs(args);
  const [action,id,amount,fee]=args,ns=key.context.storageNamespace;
  const runtime=createBrowserSessionWithdrawalRuntime(key,{json,storage:state.withdrawals.storage,...ports,
    credit:async address=>{const c=z.object({status:z.literal("known"),network:z.literal(profile.networkId),address:z.string(),available:micros}).parse(await json(`/api/session/credit?address=${encodeURIComponent(address)}`));
      if(c.address.toLowerCase()!==address.toLowerCase())refuse();return BigInt(c.available);}});
  const status=async(requestId:string)=>{const value=await json(`/api/session/withdraw/${requestId}`) as {preparation:unknown;attestation:unknown;signingPhase:string;progress:{status:string;retryAuthorized:false};};
    const p=await verifySessionWithdrawalPreparation(value.preparation);
    if(p.requestId!==requestId||p.ownerAddr!==key.context.owner||p.sessAddr!==key.address?.toLowerCase()||p.authorization.consent.origin!==key.context.origin)refuse();return{value,p};};
  if(action==="withdraw-prepare"){
    if(state.withdrawals.activeWithdrawal())refuse();
    const snapshot=await state.withdrawals.storage.readExposure(ns);
    const p=await verifySessionWithdrawalPreparation(await json("/api/session/withdraw/prepare","POST",{sessAddr:key.address!.toLowerCase(),grantEpoch:id,amountMicros:amount}));
    if(p.ownerAddr!==key.context.owner||p.sessAddr!==key.address?.toLowerCase()||p.grantEpoch!==id||p.authorization.consent.origin!==key.context.origin)refuse();
    await state.withdrawals.storage.reserveWithdrawal(ns,p,snapshot.version);
    return {requestId:p.requestId,network:p.network,owner:p.ownerAddr,session:p.sessAddr,amountMicroUsdc:p.burnIntent.spec.value,maxFeeMicroUsdc:p.burnIntent.maxFee,
      reviewAccepted:p.burnIntent.spec.value===amount&&BigInt(p.burnIntent.maxFee)<=BigInt(fee),
      signingPhase:"prepared",notice:"No burn signed. Review the exact original before signing; cancellation requires a never-exposed acknowledgement."};
  }
  if(action==="withdraw-sign"){
    await runtime.signWithdrawal(id,{amountMicroUsdc:amount,maxFeeMicroUsdc:fee});
    return {requestId:id,signatureRetained:true,notice:"Signature retained privately. Submit the original once; uncertainty remains held."};
  }
  if(action==="withdraw-cancel")return runtime.cancelUnexposedWithdrawal(id);
  const {value,p}=await status(id),local=await state.withdrawals.storage.readWithdrawal(ns,id);
  if(action==="withdraw-status")return {requestId:id,network:p.network,signingPhase:value.signingPhase,progress:value.progress,
    local:state.withdrawals.references().find(row=>row.requestId===id)??null,retryAuthorized:false};
  if(!local||local.cancelled)return refuse();
  if(action==="withdraw-submit"){
    if(!local.signature||!state.withdrawals.claimSubmission(p))refuse();
    await json("/api/session/withdraw/submit","POST",{requestId:id,signature:local.signature});
    return {requestId:id,submissionRetained:true,retryAuthorized:false};
  }
  if(action==="withdraw-mint"){
    if(!local.signature||!local.submissionPossible||local.completion)refuse();
    // Reprint the same retained handoff, never regenerate its nonce/fees on reload.
    if(local.mint)return {format:"keryx-headless-owner-mint-v1",network:profile.networkId,owner:p.ownerAddr,requestId:id,transaction:local.mint,retryAuthorized:false,
      notice:"Original handoff already claimed. Retained terms are for recovery only; do not send a second Mint transaction."};
    const record=await createWithdrawalRequest({burnIntent:p.burnIntent,signature:local.signature},p.policy,profile);
    const rpc=createPublicClient({chain:chainForProfile(profile),transport:withdrawalRpcTransport(profile.rpcUrl,AbortSignal.timeout(12000))});
    const mint=await(ports.prepareMint??prepareWithdrawalOwnerWalletMint)({record,attestation:value.attestation,owner:p.ownerAddr,rpc,
      assertCurrent(){if(key.address?.toLowerCase()!==p.sessAddr)refuse();}});
    if(!state.withdrawals.claimMint(p,mint))refuse();
    return {format:"keryx-headless-owner-mint-v1",network:profile.networkId,owner:p.ownerAddr,requestId:id,transaction:mint,retryAuthorized:false,
      notice:"Unsigned handoff only. Review and send once from the original owner wallet on Arc; preserve its nonce and transaction hash. The CLI does not send."};
  }
  if(action==="withdraw-complete"){
    state.withdrawals.retainMintHash(p,amount);
    await json("/api/session/withdraw/complete","POST",{requestId:id,transactionHash:amount});
  }
  return runtime.reconcileWithdrawal(id);
}
