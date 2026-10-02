import { encodeFunctionData, type Hex, type PublicClient, type WalletClient } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { chainForProfile } from "../chains";
import { browserSessionCustodyContext } from "./browser-session-custody";
import { createWithdrawalRequest } from "../gateway/withdrawal-request";
import { withdrawalMintObserverForRpc, WITHDRAWAL_MINTER_ABI } from "../gateway/withdrawal-mint-observation";
import { matchWithdrawalAttestation } from "../gateway/withdrawal-attestation";
import { verifySessionWithdrawalPreparation, type SessionWithdrawalPreparation } from "../gateway/session-withdrawal-protocol";
import { readBrowserSessionWithdrawal, claimBrowserSessionWithdrawalDelivery, retainBrowserSessionOwnerMintHash } from "./browser-session-withdrawal-storage";
import { canonicalJson } from "../canonical-json";

/** Owner gas authority only. Retain the exact selected nonce/calldata/fee terms before
 * the wallet prompt; lost or rejected responses remain an original recovery operation. */
export async function submitBrowserSessionOwnerMint(input: { preparation: SessionWithdrawalPreparation; attestation: unknown;
  wallet: WalletClient; rpc: PublicClient; assertCurrent(): void }) {
  const p=await verifySessionWithdrawalPreparation(structuredClone(input.preparation));input.assertCurrent();
  if(p.authorization.consent.origin!==window.location.origin)throw new Error("Original cashout origin differs");
  const context=browserSessionCustodyContext(profile,window.location.origin,p.ownerAddr),account=input.wallet.account;
  const check=async()=>{input.assertCurrent();if(!account||account.address.toLowerCase()!==p.ownerAddr||
    await input.wallet.getChainId()!==profile.chainId||await input.rpc.getChainId()!==profile.chainId||
    (await input.wallet.getAddresses())[0]?.toLowerCase()!==p.ownerAddr)throw new Error("Select the original owner on Arc mainnet");input.assertCurrent()};
  await check();
  const local=await readBrowserSessionWithdrawal(context.storageNamespace,p.requestId);
  if(!local?.signature||canonicalJson(local.preparation)!==canonicalJson(p)||local.cancelled||local.completion)throw new Error("Original signed cashout unavailable");
  if(local.mint)throw new Error("A mint attempt already exists. Recover its original owner transaction; do not submit again.");
  const record=await createWithdrawalRequest({burnIntent:p.burnIntent,signature:local.signature},p.policy,profile);
  const matched=await matchWithdrawalAttestation(record,input.attestation);
  const observation=await withdrawalMintObserverForRpc(profile.rpcUrl)(record,matched,p.ownerAddr,AbortSignal.timeout(12000));
  if(!observation)throw new Error("Fresh original mint authority is unavailable");await check();
  const data=encodeFunctionData({abi:WITHDRAWAL_MINTER_ABI,functionName:"gatewayMint",args:[matched.attestation,matched.signature]});
  const [nonce,gas,fees,balance]=await Promise.all([
    input.rpc.getTransactionCount({address:p.ownerAddr as Hex,blockTag:"pending"}),
    input.rpc.estimateGas({account:p.ownerAddr as Hex,to:profile.gatewayMinter,data,value:BigInt(0)}),
    input.rpc.estimateFeesPerGas(),input.rpc.getBalance({address:p.ownerAddr as Hex}),
  ]);await check();
  if(!Number.isSafeInteger(nonce)||nonce<0||gas<=BigInt(0)||!fees.maxFeePerGas||fees.maxPriorityFeePerGas===undefined||
    fees.maxPriorityFeePerGas< BigInt(0)||fees.maxPriorityFeePerGas>fees.maxFeePerGas||balance<gas*fees.maxFeePerGas)
    throw new Error("Review known owner gas and fee availability before minting");
  const mint={to:profile.gatewayMinter.toLowerCase(),data,value:"0" as const,nonce,gas:gas.toString(),
    maxFeePerGas:fees.maxFeePerGas.toString(),maxPriorityFeePerGas:fees.maxPriorityFeePerGas.toString()};
  if(!await claimBrowserSessionWithdrawalDelivery(context.storageNamespace,p,{mint}))throw new Error("Original owner mint is already claimed");
  await check();
  let hash:Hex;
  try{hash=await input.wallet.sendTransaction({account:account!,chain:chainForProfile(profile),to:profile.gatewayMinter,data,value:BigInt(0),
    nonce,gas,maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas});}
  catch{throw new Error("Owner mint response unavailable. Retained nonce and calldata require recovery; do not mint again.")}
  // Save the original response even if wallet/auth changed during the prompt; never publish to the replacement owner.
  await retainBrowserSessionOwnerMintHash(context.storageNamespace,p,hash.toLowerCase());await check();
  return {requestId:p.requestId,transactionHash:hash};
}
