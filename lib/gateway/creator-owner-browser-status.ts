import { z } from "zod";
import { encodeFunctionData } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { canonicalJson } from "../canonical-json";
import { readBoundedJson } from "../read-bounded-json";
import { createWithdrawalBrowserDraft } from "./withdrawal-browser-journal";
import { validateWithdrawalRequest, withdrawalOwnerSchema } from "./withdrawal-request";
import { matchWithdrawalAttestation } from "./withdrawal-attestation";
import { verifyCreatorOwnerWithdrawalCompletion } from "./creator-owner-withdrawal-protocol";
import { WITHDRAWAL_MINTER_ABI } from "./withdrawal-mint-observation";

type Draft = ReturnType<typeof createWithdrawalBrowserDraft>;
const hash=z.string().regex(/^0x[0-9a-f]{64}$/);
const schema=z.object({wallet:withdrawalOwnerSchema,record:z.unknown(),progress:z.object({requestId:hash,recipient:withdrawalOwnerSchema,
  amountMicros:z.string().regex(/^[1-9]\d{0,15}$/),status:z.enum(["request-stored","awaiting-transfer-evidence","attestation-stored","mint-finalized-observed"]),
  chainFinalityVerified:z.boolean(),retryAuthorized:z.literal(false)}).strict(),attestation:z.unknown().nullable(),
  mint:z.object({to:withdrawalOwnerSchema,data:z.string().max(8194).regex(/^0x(?:[a-fA-F0-9]{2})+$/),value:z.literal("0"),
    network:z.literal(profile.networkId),observation:z.unknown()}).strict().nullable(),completion:z.unknown().nullable()}).strict();

/** Bounded original same-origin transport. No retry, configurable endpoint or raw
 * error bodies; a response never grants permission to resend a burn or mint. */
export async function creatorOwnerBrowserJson(operation:"prepare"|"submit"|"status"|"complete",body:unknown,signal:AbortSignal){
  try{
    const response=await fetch(`/api/me/withdrawals/${operation}`,{method:"POST",credentials:"same-origin",redirect:"error",cache:"no-store",
      headers:{"Content-Type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(12000)])});
    const value=await readBoundedJson(response,65536);signal.throwIfAborted();
    if(!response.ok)throw new Error();return value;
  }catch{throw new Error("Original owner withdrawal unavailable; retain its recovery record")}
}
/** Original tuple validation only. Completion requires fresh independent RPC evidence
 * before a caller presents it as verified finality. */
export async function matchCreatorOwnerBrowserStatus(selected:Draft,value:unknown){
  const draft=createWithdrawalBrowserDraft(selected.burnIntent,selected.policy),body=schema.parse(value);
  const record=await validateWithdrawalRequest(body.record);
  if(body.wallet!==draft.owner||record.network!==profile.networkId||record.owner!==draft.owner||record.id!==draft.id||
    canonicalJson(createWithdrawalBrowserDraft(record.request.burnIntent,record.policy))!==canonicalJson(draft)||
    body.progress.requestId!==draft.id||body.progress.recipient!==draft.owner||body.progress.amountMicros!==draft.burnIntent.spec.value)
    throw new Error("Original owner withdrawal status differs");
  const attestation=body.attestation===null?null:await matchWithdrawalAttestation(record,body.attestation);
  if(body.mint&&(!attestation||body.mint.to!==profile.gatewayMinter.toLowerCase()||body.mint.data!==
    encodeFunctionData({abi:WITHDRAWAL_MINTER_ABI,functionName:"gatewayMint",args:[attestation.attestation,attestation.signature]})))
    throw new Error("Original owner mint differs");
  const completion=body.completion===null?null:await verifyCreatorOwnerWithdrawalCompletion(body.completion);
  if(body.progress.chainFinalityVerified!==!!completion||(body.progress.status==="mint-finalized-observed")!==!!completion||
    completion&&(completion.ownerAddr!==draft.owner||canonicalJson(completion.record)!==canonicalJson(record)))
    throw new Error("Original owner completion differs");
  return {...body,record,attestation,completion};
}
