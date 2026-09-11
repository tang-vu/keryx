import { z } from "zod";
import { maxUint256, type Hex } from "viem";
import type { WithdrawalRequestRecord } from "./withdrawal-request";
import type { matchWithdrawalMintTransaction } from "./withdrawal-mint-transaction";

const uint = z.string().regex(/^(0|[1-9][0-9]{0,77})$/)
  .pipe(z.string().refine(value => BigInt(value) <= maxUint256));
const hash = z.string().regex(/^0x[a-f0-9]{64}$/).transform(value => value as Hex);
const index = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const schema = z.object({ status: z.literal("mint-finalized-observed"), authority: z.literal("arc-testnet-rpc-finality"),
  requestId: hash, transactionHash: hash, transferSpecHash: hash, chainId: z.literal(5042002),
  blockNumber: uint, blockHash: hash, transactionIndex: index, logIndex: index,
  recipient: z.string().regex(/^0x[a-f0-9]{40}$/), amountMicros: uint,
  gasUsed: uint.refine(value => BigInt(value) > BigInt(0)), effectiveGasPriceWei: uint, gasCostWei: uint,
  chainFinalityVerified: z.literal(true), finalityBasis: z.literal("operator-selected-rpc"),
  finalizedBlockNumber: uint, finalizedBlockHash: hash, observedAt: z.string().datetime(),
}).strict();
export type RecordedMintObservation = z.infer<typeof schema>;

/** Revalidate the immutable worker-owned observation against its original signed
 * transaction. This is not a self-authenticating RPC proof or a fresh chain query. */
export function validateRecordedMintObservation(value: unknown, request: WithdrawalRequestRecord,
  prepared: Awaited<ReturnType<typeof matchWithdrawalMintTransaction>>) {
  try {
    const observation = schema.parse(value);
    if (observation.requestId !== request.id || observation.requestId !== prepared.requestId
      || observation.transactionHash !== prepared.transactionHash || observation.transferSpecHash !== prepared.transferSpecHash
      || observation.recipient !== request.policy.recipient || observation.amountMicros !== request.request.burnIntent.spec.value
      || BigInt(observation.gasUsed) > BigInt(prepared.terms.gas)
      || BigInt(observation.effectiveGasPriceWei) > BigInt(prepared.terms.maxFeePerGas)
      || BigInt(observation.gasUsed) * BigInt(observation.effectiveGasPriceWei) !== BigInt(observation.gasCostWei)
      || BigInt(observation.blockNumber) > BigInt(prepared.expirationBlock)
      || BigInt(observation.finalizedBlockNumber) < BigInt(observation.blockNumber)
      || observation.finalizedBlockNumber === observation.blockNumber && observation.finalizedBlockHash !== observation.blockHash)
      throw new Error();
    return observation;
  } catch { throw new Error("Recorded mint observation unavailable"); }
}

export function sameObservedMint(a: RecordedMintObservation, b: RecordedMintObservation) {
  const changing = new Set(["observedAt", "finalizedBlockNumber", "finalizedBlockHash"]);
  return Object.entries(a).every(([key, value]) => changing.has(key) || b[key as keyof RecordedMintObservation] === value);
}
