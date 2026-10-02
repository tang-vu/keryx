import { encodeFunctionData, type Hex, type PublicClient, type WalletClient } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { chainForProfile } from "../chains";
import { validateWithdrawalRequest, type WithdrawalRequestRecord } from "./withdrawal-request";
import { withdrawalMintObserverForRpc, WITHDRAWAL_MINTER_ABI } from "./withdrawal-mint-observation";
import { matchWithdrawalAttestation } from "./withdrawal-attestation";
import type { WithdrawalAttestation } from "./withdrawal-attestation";
import type { WithdrawalMintTerms } from "./withdrawal-mint-transaction";
import type { RecordedMintObservation } from "./withdrawal-recorded-observation";
import { withdrawalReceiptObserverForRpc } from "./withdrawal-receipt-observation";
import { canonicalJson } from "../canonical-json";

export type OwnerWalletMintAttempt = { to: string; data: string; value: "0"; nonce: number;
  gas: string; maxFeePerGas: string; maxPriorityFeePerGas: string; hash?: string };

/** Verify original inclusion/event/fees with the fixed browser mainnet RPC. A later
 * finalized anchor is allowed; it cannot change the original economic evidence. */
export async function observeWithdrawalOwnerWalletCompletion(outcome: {record:WithdrawalRequestRecord;attestation:WithdrawalAttestation;
  serializedTransaction:Hex;terms:WithdrawalMintTerms;observation:RecordedMintObservation}) {
  if(outcome.record.network!==profile.networkId)throw new Error("Owner mint finality network differs");
  const observed=await withdrawalReceiptObserverForRpc(profile.rpcUrl)(outcome.record,outcome.attestation,
    outcome.serializedTransaction,outcome.terms,AbortSignal.timeout(12000));
  if(!observed)throw new Error("Original withdrawal finality unavailable");
  const {finalizedBlockNumber:_number,finalizedBlockHash:_hash,observedAt:_at,...original}=outcome.observation;
  const {finalizedBlockNumber:_newNumber,finalizedBlockHash:_newHash,observedAt:_newAt,...current}=observed;
  if(canonicalJson(original)!==canonicalJson(current))throw new Error("Original withdrawal finality differs");
  return observed;
}

/** Shared session/creator owner gas authority. Only a verified original mainnet burn
 * and matching attestation can reach the fixed minter. Delivery is durably claimed
 * before the wallet prompt; uncertainty is original recovery, never retry authority. */
export async function submitWithdrawalOwnerWalletMint(input: { record: WithdrawalRequestRecord; attestation: unknown;
  wallet: WalletClient; rpc: PublicClient; assertCurrent(): void;
  claimMint(terms: OwnerWalletMintAttempt): Promise<boolean>; retainMintHash(hash: string): Promise<void> }) {
  const record=await validateWithdrawalRequest(structuredClone(input.record));input.assertCurrent();
  const owner=record.policy.recipient,account=input.wallet.account;
  if(record.network!==profile.networkId)throw new Error("Original owner mint network differs");
  const check=async()=>{input.assertCurrent();if(!account||account.address.toLowerCase()!==owner||
    await input.wallet.getChainId()!==profile.chainId||await input.rpc.getChainId()!==profile.chainId||
    (await input.wallet.getAddresses())[0]?.toLowerCase()!==owner)throw new Error("Select the original owner on Arc mainnet");input.assertCurrent()};
  await check();
  const matched=await matchWithdrawalAttestation(record,structuredClone(input.attestation));
  const observation=await withdrawalMintObserverForRpc(profile.rpcUrl)(record,matched,owner,AbortSignal.timeout(12000));
  if(!observation)throw new Error("Fresh original mint authority is unavailable");await check();
  const data=encodeFunctionData({abi:WITHDRAWAL_MINTER_ABI,functionName:"gatewayMint",args:[matched.attestation,matched.signature]});
  const [nonce,gas,fees,balance]=await Promise.all([
    input.rpc.getTransactionCount({address:owner as Hex,blockTag:"pending"}),
    input.rpc.estimateGas({account:owner as Hex,to:profile.gatewayMinter,data,value:BigInt(0)}),
    input.rpc.estimateFeesPerGas(),input.rpc.getBalance({address:owner as Hex}),
  ]);await check();
  if(!Number.isSafeInteger(nonce)||nonce<0||gas<=BigInt(0)||!fees.maxFeePerGas||fees.maxPriorityFeePerGas===undefined||
    fees.maxPriorityFeePerGas<BigInt(0)||fees.maxPriorityFeePerGas>fees.maxFeePerGas||balance<gas*fees.maxFeePerGas)
    throw new Error("Review known owner gas and fee availability before minting");
  const mint:OwnerWalletMintAttempt={to:profile.gatewayMinter.toLowerCase(),data,value:"0",nonce,gas:gas.toString(),
    maxFeePerGas:fees.maxFeePerGas.toString(),maxPriorityFeePerGas:fees.maxPriorityFeePerGas.toString()};
  if(!await input.claimMint(mint))throw new Error("Original owner mint is already claimed");await check();
  let hash:Hex;
  try{hash=await input.wallet.sendTransaction({account:account!,chain:chainForProfile(profile),to:profile.gatewayMinter,data,value:BigInt(0),
    nonce,gas,maxFeePerGas:fees.maxFeePerGas,maxPriorityFeePerGas:fees.maxPriorityFeePerGas});}
  catch{throw new Error("Owner mint response unavailable. Retained nonce and calldata require recovery; do not mint again.")}
  await input.retainMintHash(hash.toLowerCase());await check();
  return {requestId:record.id,transactionHash:hash};
}
