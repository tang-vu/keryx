import type { FundingExposure, GatewayFundingOperation, GatewayFundingPolicy, FundingStepState } from "../payments/gateway-funding-policy";
import type { GatewayFundingTransaction, SignedGatewayFundingTransaction } from "../payments/gateway-funding-transaction";
import type { StorageIdentity } from "./storage-identity";

/** Shared durable domain contract. No issuer, policy, lease or signing permission
 * is created by importing these DTOs. All implementations validate unknown input. */
export const GATEWAY_FUNDING_TABLES = Object.freeze([
  "gateway_funding_namespaces", "gateway_funding_policies", "gateway_funding_authorizations",
  "gateway_funding_operations", "gateway_funding_reservations", "gateway_funding_crypto_claims",
  "gateway_funding_prepared", "gateway_funding_broadcast_claims", "gateway_funding_observations",
] as const);
export type GatewayFundingStep = "nativeTransfer" | "usdcTransfer" | "approval" | "deposit";
export type FundingSenderRole = "funder" | "spend";
export interface FundingOwnerInstallation {
  readonly format: "gateway-funding-owner-installation-v1";
  readonly policy: Readonly<GatewayFundingPolicy>;
  readonly funderGasBudgetWei: string;
  readonly spendGasBudgetWei: string;
  readonly reviewedSnapshotDigest: string;
  readonly reviewedTargetDigest: string;
  readonly finalityPolicyDigest: string;
  /** First implementation supports only separately reviewed unused isolated
   * keys with nonce zero. Shared/funded key history migration stays refused. */
  readonly history: Readonly<{ format: "gateway-funding-empty-isolated-history-v1";
    documentDigest: string; funderInitialNonce: "0"; spendInitialNonce: "0" }>;
}
export interface FundingNamespaceSnapshot {
  readonly identityDigest: string;
  readonly chainId: "5042002";
  readonly sender: string;
  readonly peer: string;
  readonly role: FundingSenderRole;
  readonly historyDocumentDigest: string;
  readonly backendBindingDigest: string;
  readonly finalityPolicyDigest: string;
  readonly initialNonce: "0";
  readonly nextNonce: string;
  readonly limits: Readonly<FundingExposure>;
  readonly used: Readonly<FundingExposure>;
  /** Same underlying USDC balance: native wei + ERC20 movement micros * 10^12 + sender gas.
   * Separate USDC/deposit fields are movement caps, never settlement metrics. */
  readonly nativeAggregateLimitWei: string;
  readonly nativeAggregateUsedWei: string;
}
export interface FundingReservationSnapshot {
  readonly operation: Readonly<GatewayFundingOperation>;
  readonly transaction: Readonly<GatewayFundingTransaction>;
  readonly state: FundingStepState;
  readonly cryptoClaimId?: string;
  readonly prepared?: Readonly<SignedGatewayFundingTransaction>;
  readonly broadcastClaimId?: string;
  readonly terminal?: Readonly<FundingTerminalEvidence>;
}
export interface FundingClaimResult {
  /** True ONLY for the newly committed INSERT. Exact repeated claim returns
   * false, not permission to sign/send again after lost acknowledgement. */
  readonly fresh: boolean;
  readonly claimId: string;
  readonly reservation: Readonly<FundingReservationSnapshot>;
}
export interface FundingCandidateObservation {
  readonly format: "gateway-funding-candidate-observation-v1";
  readonly observationId: string;
  readonly operationId: string;
  readonly step: GatewayFundingStep;
  readonly transactionHash: string;
  readonly status: "unknown" | "seen";
  readonly observedAt: string;
  readonly evidenceDigest: string;
}
/** Extension payload, NOT public terminal authority. Controller verifies RPC
 * evidence; backend rechecks saved original+identity in its transaction. */
export interface FundingTerminalEvidence {
  readonly format: "gateway-funding-terminal-evidence-v1";
  readonly identity: Readonly<StorageIdentity>;
  readonly identityDigest: string;
  readonly operationDigest: string;
  readonly operationId: string;
  readonly step: GatewayFundingStep;
  readonly transactionHash: string;
  readonly cryptoClaimId: string;
  readonly broadcastClaimId: string;
  readonly prepared: Readonly<SignedGatewayFundingTransaction>;
  readonly sender: string;
  readonly nonce: string;
  readonly chainId: "5042002";
  readonly receiptStatus: "success" | "reverted";
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly gasUsed: string;
  readonly effectiveGasPriceWei: string;
  readonly observedAt: string;
  readonly finalityPolicyDigest: string;
  readonly finalizedBlockNumber: string;
  readonly finalizedBlockHash: string;
  readonly providerEvidenceDigest: string;
}
declare const verifiedFundingReceipt: unique symbol;
/** Actual issuer must use runtime provenance (e.g. private WeakMap), not rely on
 * this TypeScript brand. No generic JSON/caller boolean can mint this object. */
export interface VerifiedFundingTerminalObservation {
  readonly [verifiedFundingReceipt]: true;
}
export interface GatewayFundingLedger {
  getStorageIdentity(): Readonly<StorageIdentity>;
  inspectNamespace(sender: string): Promise<Readonly<FundingNamespaceSnapshot>>;
  inspectOperation(operationId: string): Promise<Readonly<GatewayFundingOperation> | null>;
  /** Reads separately installed owner authorization; cannot accept policy or
   * operation payload from an application request to mint funding authority. */
  admitOperation(operationId: string): Promise<Readonly<GatewayFundingOperation>>;
  reserveStep(operationId: string, step: GatewayFundingStep, originalNonce: string): Promise<Readonly<FundingReservationSnapshot>>;
  inspectReservation(operationId: string, step: GatewayFundingStep): Promise<Readonly<FundingReservationSnapshot> | null>;
  claimCrypto(operationId: string, step: GatewayFundingStep, claimId: string): Promise<Readonly<FundingClaimResult>>;
  savePrepared(operationId: string, step: GatewayFundingStep, cryptoClaimId: string,
    value: Readonly<{ rawTransaction: string; transactionHash: string }>): Promise<Readonly<FundingReservationSnapshot>>;
  claimBroadcast(operationId: string, step: GatewayFundingStep, claimId: string): Promise<Readonly<FundingClaimResult>>;
  appendCandidateObservation(value: FundingCandidateObservation): Promise<Readonly<FundingCandidateObservation>>;
  close(): void;
}
/** Protected observer extension for a later reviewed controlled issuer. Not
 * included in the generic app ledger above; normal service role cannot call. */
export interface GatewayFundingTerminalObserverStore {
  appendVerifiedTerminalObservation(operationId: string, step: GatewayFundingStep, value: VerifiedFundingTerminalObservation): Promise<void>;
}
