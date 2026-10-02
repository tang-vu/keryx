import type { PublicClient, WalletClient } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { browserSessionCustodyContext } from "./browser-session-custody";
import { createWithdrawalRequest } from "../gateway/withdrawal-request";
import { submitWithdrawalOwnerWalletMint } from "../gateway/withdrawal-owner-wallet-mint";
import { verifySessionWithdrawalPreparation, type SessionWithdrawalPreparation } from "../gateway/session-withdrawal-protocol";
import { readBrowserSessionWithdrawal, claimBrowserSessionWithdrawalDelivery, retainBrowserSessionOwnerMintHash } from "./browser-session-withdrawal-storage";
import { canonicalJson } from "../canonical-json";

/** Owner gas authority only. Retain the exact selected nonce/calldata/fee terms before
 * the wallet prompt; lost or rejected responses remain an original recovery operation. */
export async function submitBrowserSessionOwnerMint(input: { preparation: SessionWithdrawalPreparation; attestation: unknown;
  wallet: WalletClient; rpc: PublicClient; assertCurrent(): void }) {
  const p=await verifySessionWithdrawalPreparation(structuredClone(input.preparation));input.assertCurrent();
  if(p.authorization.consent.origin!==window.location.origin)throw new Error("Original cashout origin differs");
  const context=browserSessionCustodyContext(profile,window.location.origin,p.ownerAddr);
  const local=await readBrowserSessionWithdrawal(context.storageNamespace,p.requestId);
  if(!local?.signature||canonicalJson(local.preparation)!==canonicalJson(p)||local.cancelled||local.completion)throw new Error("Original signed cashout unavailable");
  if(local.mint)throw new Error("A mint attempt already exists. Recover its original owner transaction; do not submit again.");
  const record=await createWithdrawalRequest({burnIntent:p.burnIntent,signature:local.signature},p.policy,profile);
  return submitWithdrawalOwnerWalletMint({record,attestation:input.attestation,wallet:input.wallet,rpc:input.rpc,assertCurrent:input.assertCurrent,
    claimMint:mint=>claimBrowserSessionWithdrawalDelivery(context.storageNamespace,p,{mint}),
    retainMintHash:hash=>retainBrowserSessionOwnerMintHash(context.storageNamespace,p,hash)});
}
