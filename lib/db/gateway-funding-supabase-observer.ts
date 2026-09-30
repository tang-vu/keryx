import type { GatewayFundingLedger, GatewayFundingStep, GatewayFundingTerminalObserverStore, VerifiedFundingTerminalObservation } from "./gateway-funding-ledger-types";
import { SupabaseAuthority } from "./supabase-authority";
import { storageIdentityDigest } from "./storage-identity";
import { fundingStep, fundingUuid, validateFundingNamespace } from "./gateway-funding-ledger-validation";
import { unsealVerifiedGatewayFundingReceipt } from "../payments/gateway-funding-receipt-observer";

function refuse(): never { throw new Error("Gateway funding observer refused"); }
/** Separate protected capability, supplied with an explicitly provisioned
 * observer-role client. service_role has no SQL finalization privilege. The
 * locator cannot authorize finality: only the controlled issuer's WeakMap token
 * plus persisted originals can pass this boundary. No role promotion occurs. */
export class SupabaseGatewayFundingTerminalObserverStore implements GatewayFundingTerminalObserverStore {
  private closed = false;
  private readonly identityDigest: string;
  constructor(private readonly ledger: GatewayFundingLedger, private readonly observer: SupabaseAuthority) {
    const identity = ledger.getStorageIdentity();
    if (identity.authorityMode !== "testnet-real") refuse();
    this.identityDigest = storageIdentityDigest(identity);
    this.guard();
  }
  private guard = (): void => {
    if (this.closed || storageIdentityDigest(this.ledger.getStorageIdentity()) !== this.identityDigest
      || storageIdentityDigest(this.observer.getStorageIdentity()) !== this.identityDigest) refuse();
  };
  close(): void { this.closed = true; }
  async appendVerifiedTerminalObservation(operationId: string, selectedStep: GatewayFundingStep, token: VerifiedFundingTerminalObservation): Promise<void> {
    this.guard(); fundingUuid(operationId); fundingStep(selectedStep);
    const reservation = await this.ledger.inspectReservation(operationId, selectedStep);
    if (!reservation?.prepared || !reservation.cryptoClaimId || !reservation.broadcastClaimId) refuse();
    if (reservation.operation.operationId !== operationId || reservation.prepared.transaction.step !== selectedStep
      || storageIdentityDigest(reservation.operation.policy.identity) !== this.identityDigest) refuse();
    const [funderInput, spendInput] = await Promise.all([
      this.ledger.inspectNamespace(reservation.operation.policy.funder), this.ledger.inspectNamespace(reservation.operation.policy.spend),
    ]);
    const funder = validateFundingNamespace(funderInput, this.ledger.getStorageIdentity(), funderInput.backendBindingDigest);
    const spend = validateFundingNamespace(spendInput, this.ledger.getStorageIdentity(), funder.backendBindingDigest);
    if (funder.sender !== reservation.operation.policy.funder || spend.sender !== reservation.operation.policy.spend
      || funder.role !== "funder" || spend.role !== "spend" || funder.peer !== spend.sender || spend.peer !== funder.sender
      || funder.finalityPolicyDigest !== spend.finalityPolicyDigest) refuse();
    this.guard();
    const evidence = unsealVerifiedGatewayFundingReceipt(token, { operation: reservation.operation, prepared: reservation.prepared,
      cryptoClaimId: reservation.cryptoClaimId, broadcastClaimId: reservation.broadcastClaimId, finalityPolicyDigest: funder.finalityPolicyDigest }, this.guard);
    try {
      const result = await this.observer.rpc("funding_finalize", { p_evidence: evidence });
      this.guard(); if (result.error) refuse();
    } catch { refuse(); }
  }
}
