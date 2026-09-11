import type { WalletClient } from "viem";
import { withdrawTypedData } from "./withdraw-protocol";
import { createWithdrawalRequest, withdrawalOwnerSchema, type WithdrawalRequestRecord } from "./withdrawal-request";
import { readWithdrawalBrowserJournal, saveWithdrawalBrowserSignature, claimWithdrawalBrowserSubmission } from "./withdrawal-browser-journal";
import { readWithdrawalBrowserStatus } from "./withdrawal-browser-status";

type ActiveOwner = () => string | null;
type Transfer = (original: WithdrawalRequestRecord, signal: AbortSignal) => Promise<unknown>;
function requireActiveOwner(owner: string, activeOwner: ActiveOwner, signal: AbortSignal) {
  signal.throwIfAborted();
  if (withdrawalOwnerSchema.parse(activeOwner()) !== owner) throw new Error("Withdrawal account changed");
}

/** Uses only the already-persisted original draft. The caller supplies a live account
 * accessor (not a captured address) and an operation-specific cancellation signal. */
export async function signWithdrawalBrowserDraft(id: string, owner: string,
  wallet: Pick<WalletClient, "account" | "signTypedData">, activeOwner: ActiveOwner, signal: AbortSignal) {
  const selected = withdrawalOwnerSchema.parse(owner);
  requireActiveOwner(selected, activeOwner, signal);
  const row = await readWithdrawalBrowserJournal(id, selected);
  requireActiveOwner(selected, activeOwner, signal);
  const account = wallet.account;
  if (row.origin !== "created" || row.state !== "reserved" || !account || account.address.toLowerCase() !== selected)
    throw new Error("Withdrawal draft is not available for signing");
  const signature = await wallet.signTypedData({ account, ...withdrawTypedData(structuredClone(row.draft.burnIntent)) });
  // Retain a returned valid signature even if cancellation/account change occurred
  // during the wallet prompt. It belongs to the original owner and is never sent here.
  const original = await createWithdrawalRequest({ burnIntent: row.draft.burnIntent, signature }, row.draft.policy);
  const saved = await saveWithdrawalBrowserSignature(original, selected);
  requireActiveOwner(selected, activeOwner, signal);
  return saved;
}

/** Claim before invoking the app-owned transport. Lost responses, cancellation and
 * imports are recovery-only; this function never creates a draft or requests a signature.
 * Transport response is deliberately not accepted as settlement/finality evidence. */
export async function submitWithdrawalBrowserOnce(id: string, owner: string, activeOwner: ActiveOwner,
  transfer: Transfer, signal: AbortSignal) {
  const selected = withdrawalOwnerSchema.parse(owner);
  requireActiveOwner(selected, activeOwner, signal);
  const row = await readWithdrawalBrowserJournal(id, selected);
  requireActiveOwner(selected, activeOwner, signal);
  if (!row.request) throw new Error("Withdrawal signature is unavailable");
  const admitted = await claimWithdrawalBrowserSubmission(row.request, selected);
  requireActiveOwner(selected, activeOwner, signal);
  if (!admitted) return { state: "recovery-required" as const };
  try {
    requireActiveOwner(selected, activeOwner, signal);
    // Reread the committed original. A missing/corrupt journal cannot be replaced
    // with the in-memory candidate after consuming the submission marker.
    const claimed = await readWithdrawalBrowserJournal(id, selected);
    requireActiveOwner(selected, activeOwner, signal);
    if (claimed.state !== "submission-possible" || !claimed.request) throw new Error();
    await transfer(structuredClone(claimed.request), signal);
  } catch {
    // A local claim remains consumed even when transport was never reached.
  }
  requireActiveOwner(selected, activeOwner, signal);
  return { state: "recovery-required" as const };
}

/** Recovery reads only. Missing server evidence never resets a consumed local claim. */
export async function recoverWithdrawalBrowserStatus(id: string, owner: string, activeOwner: ActiveOwner, signal: AbortSignal) {
  const selected = withdrawalOwnerSchema.parse(owner);
  requireActiveOwner(selected, activeOwner, signal);
  const row = await readWithdrawalBrowserJournal(id, selected);
  requireActiveOwner(selected, activeOwner, signal);
  const result = await readWithdrawalBrowserStatus(row.draft, signal);
  requireActiveOwner(selected, activeOwner, signal);
  return result;
}
