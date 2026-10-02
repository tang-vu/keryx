import { z } from "zod";
import type { Hex, PublicClient, WalletClient } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { browserPaymentProfile } from "../browser-payment-profile";
import { canonicalJson } from "../canonical-json";
import { withdrawPolicySchema } from "./withdraw-protocol";
import { withdrawalOwnerSchema } from "./withdrawal-request";
import { createWithdrawalBrowserDraft, reserveWithdrawalBrowserJournal, readWithdrawalBrowserJournal,
  claimWithdrawalBrowserOwnerMint,retainWithdrawalBrowserOwnerMintHash } from "./withdrawal-browser-journal";
import { signWithdrawalBrowserDraft, submitWithdrawalBrowserOnce } from "./withdrawal-browser-flow";
import { creatorOwnerBrowserJson,matchCreatorOwnerBrowserStatus } from "./creator-owner-browser-status";
import { readCreatorOwnerBrowserWindow } from "./creator-owner-browser-chain";
import { submitWithdrawalOwnerWalletMint,observeWithdrawalOwnerWalletCompletion } from "./withdrawal-owner-wallet-mint";

const integer=z.string().regex(/^(0|[1-9]\d{0,15})$/).refine(v=>BigInt(v)<=BigInt(Number.MAX_SAFE_INTEGER));
export type CreatorOwnerReview={amountMicroUsdc:string;maxFeeMicroUsdc:string};
const preparationSchema=z.object({wallet:withdrawalOwnerSchema,draft:z.object({id:z.string(),owner:withdrawalOwnerSchema,
  policy:withdrawPolicySchema,burnIntent:z.unknown()}).strict(),preparedAt:z.string().datetime()}).strict();
type ActiveOwner=()=>string|null;
function check(owner:string,current:ActiveOwner,signal:AbortSignal){signal.throwIfAborted();
  if(browserPaymentProfile()!==profile||withdrawalOwnerSchema.parse(current())!==owner)throw new Error("Creator withdrawal owner changed")}
async function walletCheck(owner:string,wallet:WalletClient,current:ActiveOwner,signal:AbortSignal){check(owner,current,signal);
  if(wallet.account?.address.toLowerCase()!==owner||await wallet.getChainId()!==profile.chainId||
    (await wallet.getAddresses())[0]?.toLowerCase()!==owner)throw new Error("Connect the original creator on Arc mainnet");check(owner,current,signal)}

export function matchCreatorOwnerBrowserPreparation(owner:string,review:CreatorOwnerReview,value:unknown){
  const selected=withdrawalOwnerSchema.parse(owner),amount=integer.refine(v=>BigInt(v)>BigInt(0)).parse(review.amountMicroUsdc),fee=integer.parse(review.maxFeeMicroUsdc);
  const body=preparationSchema.parse(value),draft=createWithdrawalBrowserDraft(body.draft.burnIntent,body.draft.policy);
  if(body.wallet!==selected||draft.owner!==selected||draft.policy.recipient!==selected||canonicalJson(body.draft)!==canonicalJson(draft)||
    draft.burnIntent.spec.value!==amount||draft.policy.maxValueMicros!==amount||BigInt(draft.burnIntent.maxFee)>BigInt(fee))
    throw new Error("Prepared creator amount, fee or owner differs from your review");
  return draft;
}
export async function prepareCreatorOwnerBrowserWithdrawal(owner:string,review:CreatorOwnerReview,current:ActiveOwner,signal:AbortSignal){
  review={...review};
  const selected=withdrawalOwnerSchema.parse(owner);check(selected,current,signal);
  const amount=integer.refine(v=>BigInt(v)>BigInt(0)).parse(review.amountMicroUsdc);integer.parse(review.maxFeeMicroUsdc);
  const body=await creatorOwnerBrowserJson("prepare",{amountMicros:amount},signal);check(selected,current,signal);
  const draft=matchCreatorOwnerBrowserPreparation(selected,review,body);
  await readCreatorOwnerBrowserWindow(draft.burnIntent,signal);check(selected,current,signal);
  const row=await reserveWithdrawalBrowserJournal(draft,selected);check(selected,current,signal);return row;
}
export async function signCreatorOwnerBrowserWithdrawal(id:string,owner:string,review:CreatorOwnerReview,wallet:WalletClient,current:ActiveOwner,signal:AbortSignal){
  review={...review};
  const selected=withdrawalOwnerSchema.parse(owner);await walletCheck(selected,wallet,current,signal);
  const row=await readWithdrawalBrowserJournal(id,selected);check(selected,current,signal);
  if(row.draft.burnIntent.spec.value!==integer.parse(review.amountMicroUsdc)||BigInt(row.draft.burnIntent.maxFee)>BigInt(integer.parse(review.maxFeeMicroUsdc)))
    throw new Error("Original creator amount or fee review differs");
  await readCreatorOwnerBrowserWindow(row.draft.burnIntent,signal);await walletCheck(selected,wallet,current,signal);
  const signed=await signWithdrawalBrowserDraft(id,selected,wallet,current,signal);await walletCheck(selected,wallet,current,signal);return signed;
}
export function submitCreatorOwnerBrowserWithdrawal(id:string,owner:string,current:ActiveOwner,signal:AbortSignal){
  return submitWithdrawalBrowserOnce(id,owner,current,async(record,selectedSignal)=>{
    check(record.owner,current,selectedSignal);
    const body=await creatorOwnerBrowserJson("submit",record.request,selectedSignal);check(record.owner,current,selectedSignal);
    await matchCreatorOwnerBrowserStatus(createWithdrawalBrowserDraft(record.request.burnIntent,record.policy),body);
  },signal);
}
export async function recoverCreatorOwnerBrowserWithdrawal(id:string,owner:string,current:ActiveOwner,signal:AbortSignal){
  const selected=withdrawalOwnerSchema.parse(owner);check(selected,current,signal);const row=await readWithdrawalBrowserJournal(id,selected);check(selected,current,signal);
  const body=await creatorOwnerBrowserJson("status",{id},signal);check(selected,current,signal);
  const status=await matchCreatorOwnerBrowserStatus(row.draft,body);check(selected,current,signal);
  if(status.completion){await observeWithdrawalOwnerWalletCompletion(status.completion);check(selected,current,signal)}return status;
}
export async function mintCreatorOwnerBrowserWithdrawal(id:string,owner:string,wallet:WalletClient,rpc:PublicClient,current:ActiveOwner,signal:AbortSignal){
  const selected=withdrawalOwnerSchema.parse(owner),row=await readWithdrawalBrowserJournal(id,selected);check(selected,current,signal);
  if(!row.request||row.state!=="submission-possible"||row.mint)throw new Error("Original creator transfer/mint requires recovery");
  const status=await recoverCreatorOwnerBrowserWithdrawal(id,selected,current,signal);
  if(!status.attestation||status.completion)throw new Error("Original creator mint unavailable");
  return submitWithdrawalOwnerWalletMint({record:row.request,attestation:status.attestation,wallet,rpc,assertCurrent:()=>check(selected,current,signal),
    claimMint:mint=>claimWithdrawalBrowserOwnerMint(id,selected,mint),retainMintHash:hash=>retainWithdrawalBrowserOwnerMintHash(id,selected,hash)});
}
export async function completeCreatorOwnerBrowserWithdrawal(id:string,owner:string,transactionHash:Hex,current:ActiveOwner,signal:AbortSignal){
  const selected=withdrawalOwnerSchema.parse(owner),row=await readWithdrawalBrowserJournal(id,selected);check(selected,current,signal);
  const body=await creatorOwnerBrowserJson("complete",{id,transactionHash},signal);check(selected,current,signal);
  const status=await matchCreatorOwnerBrowserStatus(row.draft,body);check(selected,current,signal);
  if(!status.completion)throw new Error("Original creator mint finality unavailable");
  await observeWithdrawalOwnerWalletCompletion(status.completion);check(selected,current,signal);return status;
}
