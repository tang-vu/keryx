import { recoverMessageAddress, type Hex } from "viem";
import { createHash } from "node:crypto";
import { canonicalJson } from "../../lib/canonical-json";
import type { BrowserSessionAuthorizationBinding } from "../../lib/session/browser-session-runtime";
import { z } from "zod";
import { ARC_MAINNET_PROFILE as profile } from "../../lib/arc-network-profile";
import type { BrowserSessionCustodyContext } from "../../lib/session/browser-session-custody";
import { createSessionGrantConsentMessage,createSessionGrantSignerProofMessage,parseSessionGrantConsent } from "../../lib/payments/session-grant-consent";
const address=z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform(a=>a.toLowerCase());
const result=z.object({retryAuthorized:z.literal(false),statusAuthority:z.literal("retained-journal-only"),settlementConfirmed:z.boolean(),
  authorization:z.object({consent:z.unknown(),ownerSignature:z.string().regex(/^0x[0-9a-fA-F]{130}$/),sessionSignature:z.string().regex(/^0x[0-9a-fA-F]{130}$/)}),
  journal:z.object({requestId:z.string().uuid(),sessionId:address,grantEpoch:z.string().uuid(),signer:address,nonce:z.string().regex(/^0x[0-9a-f]{64}$/),phase:z.string().max(64),
    requirements:z.object({scheme:z.literal("exact"),network:z.literal(profile.networkId),asset:address,amount:z.string().regex(/^[1-9]\d{0,15}$/),
      payTo:address,maxTimeoutSeconds:z.number().int().min(604900).max(691200),extra:z.object({name:z.literal("GatewayWalletBatched"),version:z.literal("1"),verifyingContract:address})}),
    payment:z.object({authorizationId:z.string(),payer:address,payee:address,kind:z.enum(["fetch","citation"]),sourceId:z.string().min(1).max(128),network:z.literal(profile.networkId),settled:z.boolean(),settlementStatus:z.string().nullable().optional(),
      amountUsdc:z.number().finite().nonnegative(),txHash:z.string().max(256).nullable().optional()})})});
/** Expired/revoked grants remain readable, but never regain signing authority. */
export async function inspectHeadlessOriginal(input:unknown,expected:{context:BrowserSessionCustodyContext;signer:string;
  reqId:string;nonce:string;epoch:string;amount:string;cap:string;original:BrowserSessionAuthorizationBinding;requirementsDigest:string}){
  const parsed=result.parse(input),{journal,authorization}=parsed,consent=parseSessionGrantConsent(authorization.consent,profile);
  const fail=():never=>{throw new Error("Original headless authorization evidence refused");};
  if(!expected.original || expected.original.sessionId!==expected.context.owner || expected.original.sessAddr!==expected.signer.toLowerCase() ||
    expected.original.reqId!==expected.reqId || expected.original.grantEpoch!==expected.epoch || expected.original.expectedNonce!==expected.nonce ||
    !/^[0-9a-f]{64}$/.test(expected.requirementsDigest) ||
    createHash("sha256").update(canonicalJson(expected.original.requirements)).digest("hex")!==expected.requirementsDigest ||
    createHash("sha256").update(canonicalJson(journal.requirements)).digest("hex")!==expected.requirementsDigest ||
    expected.context.profile!==profile||journal.requestId!==expected.reqId||journal.nonce!==expected.nonce||journal.grantEpoch!==expected.epoch||
    journal.sessionId!==expected.context.owner||journal.signer!==expected.signer.toLowerCase()||journal.payment.authorizationId!==expected.nonce||
    journal.requirements.asset!==profile.usdcAddress.toLowerCase()||journal.requirements.extra.verifyingContract!==profile.gatewayWallet.toLowerCase()||
    journal.payment.kind!==expected.original.kind||journal.payment.sourceId!==expected.original.sourceId||
    journal.payment.payer!==journal.signer||journal.payment.payee!==journal.requirements.payTo||
    journal.requirements.amount!==expected.amount||Math.round(journal.payment.amountUsdc*1e6)!==Number(expected.amount)||
    consent.ownerAddr!==expected.context.owner||consent.sessAddr!==journal.signer||consent.origin!==expected.context.origin||
    consent.grantEpoch!==expected.epoch||consent.capMicroUsdc!==expected.cap||
    (await recoverMessageAddress({message:createSessionGrantConsentMessage(consent,profile),signature:authorization.ownerSignature as Hex})).toLowerCase()!==expected.context.owner||
    (await recoverMessageAddress({message:createSessionGrantSignerProofMessage(consent,profile),signature:authorization.sessionSignature as Hex})).toLowerCase()!==journal.signer)fail();
  /** This is bound retained server evidence, not an independently observed chain receipt. */
  const settled=journal.phase==="settled"&&journal.payment.settled&&journal.payment.settlementStatus==="settled"&&!!journal.payment.txHash;
  if(parsed.settlementConfirmed!==settled)fail();
  return{reqId:expected.reqId,nonce:expected.nonce,epoch:expected.epoch,network:profile.networkId,phase:journal.phase,
    settlementConfirmed:settled,txHash:settled?journal.payment.txHash!:undefined,retryAuthorized:false as const};
}
