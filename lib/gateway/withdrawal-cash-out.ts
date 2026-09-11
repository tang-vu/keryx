import { formatUnits, parseUnits } from "viem";
import type { KeryxDB } from "../db/keryx-db";
import type { createWithdrawalMintJournal } from "./withdrawal-mint-journal";
import { withdrawalIdSchema } from "./withdrawal-request";

type Journal = Pick<ReturnType<typeof createWithdrawalMintJournal>, "getSlot" | "getObserved">;
type Store = Pick<KeryxDB, "getCreatorWithdrawal" | "recordWithdrawal">;

export function withdrawalLedgerAmount(value: string) {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error("Cash-out amount cannot be represented exactly");
  const micros = BigInt(value), amount = Number(formatUnits(micros, 6));
  if (micros > BigInt(Number.MAX_SAFE_INTEGER) || !Number.isFinite(amount)
    || parseUnits(amount.toFixed(6), 6) !== micros) throw new Error("Cash-out amount cannot be represented exactly");
  return amount;
}

/** Operator-only reporting bridge. Inputs select retained original evidence, never
 * supply a transaction, amount or claimed finality. Repeating this operation can only
 * repeat the idempotent ledger write; it has no signing/transfer/broadcast capability. */
export async function recordObservedWithdrawalCashOut(journal: Journal, store: Store, selectedId: string, signal: AbortSignal) {
  const id = withdrawalIdSchema.parse(selectedId); signal.throwIfAborted();
  const slot = await journal.getSlot(id); signal.throwIfAborted();
  if (!slot) return { state: "not-observed" as const };
  const observation = await journal.getObserved(id); signal.throwIfAborted();
  if (!observation) return { state: "not-observed" as const };
  const original = await store.getCreatorWithdrawal(id, slot.request.owner); signal.throwIfAborted();
  if (!original || JSON.stringify(original) !== JSON.stringify(slot.request)) throw new Error("Cash-out original unavailable");
  // The legacy public ledger uses a JS number/SQL numeric. Refuse any conversion
  // that cannot round-trip every micro-USDC instead of silently changing the value.
  const amountUsdc = withdrawalLedgerAmount(observation.amountMicros);
  signal.throwIfAborted();
  await store.recordWithdrawal({ txHash: observation.transactionHash, wallet: original.owner,
    recipient: observation.recipient, amountUsdc, network: "eip155:5042002",
    label: "Creator withdrawal", createdAt: observation.observedAt });
  // A cancelled/lost write response can recover this same report later. The mint
  // observation remains authoritative and is never removed by ledger uncertainty.
  signal.throwIfAborted();
  return { state: "recorded" as const, transactionHash: observation.transactionHash };
}
