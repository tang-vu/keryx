import type { PaymentRecord } from "../types";
import type { PaymentRequirements } from "../payments/x402-payment-evidence";
import type { BrowserAuthorizationIntent } from "./browser-authorization-admission";
import { prepareBrowserAuthorizationIntent } from "./browser-authorization-admission";
import { ARC_TESTNET_PROFILE, type ArcNetworkProfile } from "../arc-network-profile";

export type BrowserAuthorizationPhase =
  | "prepared"
  | "exposed"
  | "signed"
  | "submission_attempted"
  | "settled"
  | "failed"
  | "cancelled_unexposed";

/** No signature or bearer header belongs in this durable record. */
export interface BrowserAuthorizationJournal {
  nonce: string;
  /** Immutable admission timestamp from the authorization intent. */
  admittedAt: string;
  sessionId: string;
  requestId: string;
  grantEpoch: string;
  signer: string;
  requirements: PaymentRequirements;
  phase: BrowserAuthorizationPhase;
  payment: PaymentRecord;
  signedValidAfter?: string;
  signedValidBefore?: string;
  signedHeaderHash?: string;
}

export interface BrowserJournalAdmission extends BrowserAuthorizationIntent {
  requirements: PaymentRequirements;
  payment: Omit<
    PaymentRecord,
    | "id"
    | "authorizationId"
    | "authorizationExpiresAt"
    | "createdAt"
    | "settled"
    | "settlementStatus"
  >;
}

export type BrowserJournalAdmissionResult =
  | { status: "admitted"; journal: BrowserAuthorizationJournal }
  | { status: "inactive" | "grant_or_cap_refused" };

export interface BrowserSignedMetadata {
  validAfter: string;
  validBefore: string;
  /** SHA-256 of the verified header supports exact replay detection without retaining a bearer. */
  headerHash: string;
}

export class BrowserGrantRecoveryRefused extends Error {
  constructor() {
    super(
      "Session recovery cannot reset retained authorization capacity; use the original signer and cumulative cap."
    );
  }
}

export function prepareBrowserJournal(
  input: BrowserJournalAdmission,
  profile: ArcNetworkProfile = ARC_TESTNET_PROFILE
): BrowserAuthorizationJournal {
  const intent = prepareBrowserAuthorizationIntent(input, profile);
  const p = input.payment,
    r = input.requirements;
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (
    p.kind !== intent.kind ||
    p.queryId !== intent.queryId ||
    p.sourceId !== intent.sourceId ||
    (p.offerId ?? null) !== intent.offerId ||
    !same(p.payer, intent.signer) ||
    !same(p.payee, intent.payee) ||
    p.network !== intent.network ||
    p.grantEpoch !== intent.grantEpoch ||
    !Number.isFinite(p.amountUsdc) ||
    Math.abs(p.amountUsdc * 1e6 - intent.amountMicroUsdc) > 0.000001 ||
    r.scheme !== "exact" ||
    r.network !== intent.network ||
    !same(r.asset, intent.token) ||
    !same(r.payTo, intent.payee) ||
    r.amount !== String(intent.amountMicroUsdc) ||
    r.extra?.name !== "GatewayWalletBatched" ||
    r.extra.version !== "1" ||
    !same(r.extra.verifyingContract, intent.gatewayContract) ||
    !Number.isInteger(r.maxTimeoutSeconds) ||
    r.maxTimeoutSeconds < 604900 ||
    r.maxTimeoutSeconds > 691200
  ) {
    throw new Error("Browser journal economic tuple differs from challenge");
  }
  return {
    nonce: intent.nonce,
    admittedAt: intent.createdAt,
    sessionId: intent.sessionId,
    requestId: intent.requestId,
    grantEpoch: intent.grantEpoch,
    signer: intent.signer,
    phase: "prepared",
    requirements: structuredClone(r),
    payment: {
      ...structuredClone(p),
      id: `x402:${intent.nonce}`,
      authorizationId: intent.nonce,
      authorizationPhase: "prepared",
      createdAt: intent.createdAt,
      settled: false,
      settlementStatus: "pending",
    },
  };
}
