import type { Address, PublicClient, WalletClient } from "viem";
import { ARC_MAINNET_PROFILE as profile } from "../arc-network-profile";
import { browserPaymentProfile } from "../browser-payment-profile";
import { acknowledgeSessionFundingCredit, createFundingRecord, listFundingRecords } from "../buyer/funding-journal";
import { recoverFundingStep, submitFundingStep } from "../buyer/funding-client";
import type { FundingRecord, FundingStep } from "../buyer/funding-policy";
export { GATEWAY_DEPOSIT_FOR_ABI } from "../buyer/funding-policy";
import { hasOriginalSessionDepositCredit, readOwnerSessionCredit, type SessionFundingCredit } from "./session-funding-credit";
import { readRetainedSessionGrantReference } from "./browser-session-grant-reference";
export type OwnerFundingPhase = "approval-awaiting" | "approval-submitted" | "approved" | "deposit-awaiting" | "deposit-submitted" | "deposited";

export async function reconcileOwnerSessionCredit(owner: Address, signer: Address, knownAvailableMicros: bigint) {
  for (const row of await listFundingRecords(owner)) {
    if (row.depositor?.toLowerCase() === signer.toLowerCase() && row.activePayer && row.deposit.status === "confirmed") {
      if (!row.gatewayCreditObservedAt) { await acknowledgeSessionFundingCredit(row.id, knownAvailableMicros); continue; }
      const projection = await readOwnerSessionCredit(signer, readRetainedSessionGrantReference(owner, signer), row.gatewayCreditObservedAt);
      await acknowledgeSessionFundingCredit(row.id, BigInt(projection.available), projection);
    }
  }
}
export async function acknowledgeOwnerSessionCredit(record: FundingRecord, owner: string) {
  const projection = await readOwnerSessionCredit(record.depositor!, readRetainedSessionGrantReference(owner, record.depositor!), record.gatewayCreditObservedAt);
  const available = BigInt(projection.available);
  if (!hasOriginalSessionDepositCredit(record, available, record.gatewayCreditObservedAt ? projection : undefined)) return null;
  if (!await acknowledgeSessionFundingCredit(record.id, available, record.gatewayCreditObservedAt ? projection : undefined)) return null;
  return projection;
}

/** The normal buyer funding journal already retains nonce, exact calldata, replacements and
 * uncertainty across tabs. Session funding uses that same machinery with a distinct depositor;
 * the worker has no funding transaction authority. A submission is never automatically retried.
 */
export async function fundOwnerGatewaySession(input: { owner: Address; signer: Address; amountMicros: string;
  knownAvailableMicros: bigint; creditSnapshot?: SessionFundingCredit;
  wallet: WalletClient; rpc: PublicClient; assertCurrent?(): void; onPhase?(phase: OwnerFundingPhase): void }) {
  if (browserPaymentProfile() !== profile || input.owner.toLowerCase() === input.signer.toLowerCase()) throw new Error("Mainnet session funding terms unavailable");
  const rows = await listFundingRecords(input.owner);
  let record = rows.find(row => row.activePayer === input.owner.toLowerCase());
  if (record && (record.depositor?.toLowerCase() !== input.signer.toLowerCase() || record.amount !== input.amountMicros))
    throw new Error("A retained funding transaction needs reconciliation before adding funds");
  if (input.creditSnapshot && (input.creditSnapshot.address !== input.signer.toLowerCase() ||
    input.creditSnapshot.available !== input.knownAvailableMicros.toString())) throw new Error("Session funding baseline differs");
  record ??= await createFundingRecord(input.owner, input.amountMicros, input.signer, input.knownAvailableMicros.toString(), input.creditSnapshot?.observedAt);
  async function confirm(step: FundingStep, current: FundingRecord) {
    for (let attempt=0; attempt<30; attempt++) {
      input.assertCurrent?.();
      let checked: FundingRecord | null = null;
      try { checked = await recoverFundingStep(current.id, step, input.rpc); }
      catch { /* Keep original nonce/hash and refuse another signing prompt. */ }
      if (checked?.[step].status === "confirmed") return checked;
      if (checked && ["reverted","replaced"].includes(checked[step].status)) throw new Error("Funding did not confirm the reviewed transaction");
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    throw new Error("Funding confirmation is unresolved. Inspect the retained original transaction; do not send it again.");
  }
  for (const step of ["approval", "deposit"] as const) {
    input.assertCurrent?.();
    if (record[step].status === "confirmed") continue;
    if (["ready", "rejected"].includes(record[step].status)) {
      input.onPhase?.(step === "approval" ? "approval-awaiting" : "deposit-awaiting");
      const result = await submitFundingStep({ id: record.id, step, wallet: input.wallet, chain: input.rpc });
      if (result.state !== "submitted") throw new Error(result.state === "rejected" ? "Funding request rejected" : "Funding response uncertain; reconcile the saved original transaction");
    } else if (record[step].status !== "submitted") throw new Error("Funding needs recovery of its original transaction before another deposit");
    input.onPhase?.(step === "approval" ? "approval-submitted" : "deposit-submitted");
    record = await confirm(step, record);
    input.assertCurrent?.();
    input.onPhase?.(step === "approval" ? "approved" : "deposited");
  }
  return record;
}
