import { createPublicClient, type Hex } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { chainForProfile } from "../chains";
import { withdrawalRpcTransport } from "../gateway/withdrawal-rpc-transport";
import { withdrawalReceiptObserverForRpc } from "../gateway/withdrawal-receipt-observation";
import { canonicalJson } from "../canonical-json";
import type { SessionWithdrawalPreparation } from "../gateway/session-withdrawal-protocol";
import type { SessionWithdrawalCompletion } from "../gateway/session-withdrawal-completion";
import { browserSessionCashoutMaxAheadBlocks } from "./browser-session-cashout-policy";

/** Fixed compiled mainnet RPC only. Gateway balance/processing metadata remains a
 * fresh trusted same-origin Circle relay; this verifies canonical chain and finite bounds. */
export async function readBrowserSessionWithdrawalChain(preparation: SessionWithdrawalPreparation) {
  const signal = AbortSignal.timeout(12000), ahead = BigInt(browserSessionCashoutMaxAheadBlocks());
  const client = createPublicClient({ chain: chainForProfile(profile), transport: withdrawalRpcTransport(profile.rpcUrl, signal) });
  if (await client.getChainId() !== profile.chainId) throw new Error("Withdrawal network differs");
  const block = await client.getBlock({ blockTag: "latest" }), original = await client.getBlock({ blockNumber: BigInt(preparation.height.observedBlockNumber) });
  const age = Date.now()-Number(block.timestamp)*1000;
  if (block.number === null || block.hash === null || !Number.isFinite(age) || age < -5000 || age > 60000 ||
    original.hash !== preparation.height.observedBlockHash || original.number !== BigInt(preparation.height.observedBlockNumber) ||
    block.number < original.number! || BigInt(preparation.burnIntent.maxBlockHeight) <= block.number ||
    BigInt(preparation.height.maximumBlockHeight) > original.number!+ahead ||
    BigInt(preparation.burnIntent.maxBlockHeight) > block.number+ahead) throw new Error("Withdrawal block window differs");
  for (const address of [profile.gatewayWallet, profile.gatewayMinter]) {
    const code = await client.getCode({ address: address as Hex, blockNumber: block.number });
    if (!code || !/^0x(?:[0-9a-fA-F]{2})+$/.test(code)) throw new Error("Withdrawal contract unavailable");
  }
  const again = await client.getBlock({ blockNumber: block.number });
  if (again.hash !== block.hash || again.timestamp !== block.timestamp || await client.getChainId() !== profile.chainId) throw new Error("Withdrawal chain changed");
  signal.throwIfAborted();
}
export async function observeBrowserSessionWithdrawalCompletion(outcome: SessionWithdrawalCompletion) {
  const observed = await withdrawalReceiptObserverForRpc(profile.rpcUrl)(outcome.record, outcome.attestation,
    outcome.serializedTransaction, outcome.terms, AbortSignal.timeout(12000));
  if (!observed) throw new Error("Original withdrawal finality unavailable");
  // A newer finalized block/time is allowed; original inclusion/event/economic evidence is immutable.
  const { finalizedBlockNumber: _number, finalizedBlockHash: _hash, observedAt: _at, ...original } = outcome.observation;
  const { finalizedBlockNumber: _newNumber, finalizedBlockHash: _newHash, observedAt: _newAt, ...current } = observed;
  if (canonicalJson(original) !== canonicalJson(current)) throw new Error("Original withdrawal finality differs");
  return observed;
}
