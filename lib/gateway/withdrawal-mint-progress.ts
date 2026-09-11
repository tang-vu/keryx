import { validateWithdrawalRequest, withdrawalOwnerSchema, type WithdrawalRequestRecord } from "./withdrawal-request";
import type { createWithdrawalMintJournal } from "./withdrawal-mint-journal";

type Journal = Pick<ReturnType<typeof createWithdrawalMintJournal>, "getSlot" | "getPrepared" | "getObserved">;

/** Private owner projection from the protected worker journal. The caller must obtain
 * owner from a live session and reauthenticate before releasing HTTP data. No RPC,
 * signing, broadcast or cash-out ledger write occurs here. */
export async function readWithdrawalMintProgress(journal: Journal, value: WithdrawalRequestRecord,
  authenticatedOwner: string, signal: AbortSignal) {
  const record = await validateWithdrawalRequest(structuredClone(value));
  signal.throwIfAborted();
  if (withdrawalOwnerSchema.parse(authenticatedOwner) !== record.owner) throw new Error("Withdrawal owner unavailable");
  const base = { wallet: record.owner, requestId: record.id, recipient: record.policy.recipient,
    amountMicros: record.request.burnIntent.spec.value };
  const slot = await journal.getSlot(record.id); signal.throwIfAborted();
  if (!slot) return { ...base, mintStatus: "not-queued" as const, chainFinalityVerified: false as const };
  if (JSON.stringify(slot.request) !== JSON.stringify(record)) throw new Error("Withdrawal mint original mismatch");
  const observation = await journal.getObserved(record.id); signal.throwIfAborted();
  if (observation) return { ...base, mintStatus: "finalized-observed" as const, chainFinalityVerified: true as const,
    transactionHash: observation.transactionHash, blockNumber: observation.blockNumber, blockHash: observation.blockHash,
    observedAt: observation.observedAt, finalityBasis: observation.finalityBasis };
  const prepared = await journal.getPrepared(record.id); signal.throwIfAborted();
  // Prepared bytes do not prove broadcast, inclusion or a failed transaction.
  return { ...base, mintStatus: prepared ? "prepared" as const : "queued" as const, chainFinalityVerified: false as const };
}
