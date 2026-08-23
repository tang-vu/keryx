import type { Decision, QueryRun, SourceItemIdentity } from "./types";

export const RESEARCH_RECEIPT_SCHEMA = "urn:keryx:research-receipt:1" as const;
export const RESEARCH_RECEIPT_CANONICALIZATION = "keryx-json-v1" as const;

export type ReceiptAsset = Partial<SourceItemIdentity>;

export interface ReceiptDecision extends ReceiptAsset {
  sourceId: string;
  sourceName: string;
  action: Decision["action"];
  expectedValue: number;
  priceUsdc: number;
  listPriceUsdc?: number;
  offerId?: string;
  confidence: number;
  rationale: string;
  targets: number[];
  external: boolean;
}

export interface ReceiptEvidence extends ReceiptAsset {
  marker: string;
  sourceId: string;
  sourceName: string;
  quote: string;
  support: number;
  qualifiesForReward: boolean;
}

export interface ReceiptClaim {
  claimIndex: number;
  claim: string;
  coverage: number | null;
  coveredBy: string[];
  evidence: ReceiptEvidence[];
}

export interface ReceiptCitation extends ReceiptAsset {
  marker: string;
  sourceId: string;
  sourceName: string;
  weight: number;
  /** Agent allocation. Settlement truth remains in `settlement.creatorPayments`. */
  rewardPlannedUsdc: number;
  rationale: string;
}

export type ReceiptPaymentStatus = "settled" | "pending" | "failed" | "simulated";

export interface ReceiptCreatorPayment extends ReceiptAsset {
  kind: "fetch" | "citation";
  sourceId: string;
  sourceName: string;
  payee: string;
  amountUsdc: number;
  network: string;
  status: ReceiptPaymentStatus;
  /** Circle Gateway transfer id. It is not an EVM transaction hash. */
  circleTransferId?: string;
  createdAt: string;
}

export type ReceiptLedgerCompleteness =
  | "complete"
  | "incomplete"
  | "legacy"
  | "not_applicable";

export type ReceiptSettlementStatus =
  | "settled"
  | "pending"
  | "failed"
  | "mixed"
  | "none"
  | "offline"
  | "incomplete";

export interface ReceiptSettlement {
  mode: "real" | "offline" | "legacy";
  status: ReceiptSettlementStatus;
  ledgerCompleteness: ReceiptLedgerCompleteness;
  expectedRecordedPaymentsAtFinish: number | null;
  recordedCreatorPayments: number;
  settledCreatorPayments: number;
  pendingCreatorPayments: number;
  failedCreatorPayments: number;
  simulatedCreatorPayments: number;
  settledCreators: number;
  settledCreatorUsdc: number;
  settledAccessUsdc: number;
  settledCitationUsdc: number;
  pendingCreatorUsdc: number;
  failedCreatorUsdc: number;
  simulatedCreatorUsdc: number;
  creatorPayments: ReceiptCreatorPayment[];
}

export interface ResearchReceiptPayload {
  schema: typeof RESEARCH_RECEIPT_SCHEMA;
  dispatch: {
    id: string;
    question: string;
    answer: string;
    answerSha256: `sha256:${string}`;
    createdAt: string;
    budgetUsdc: number;
    researchMode: "quick" | "deep";
    engine: string;
    confidence: QueryRun["confidence"] | null;
  };
  agency: { decisions: ReceiptDecision[] };
  claims: ReceiptClaim[];
  citations: ReceiptCitation[];
  settlement: ReceiptSettlement;
  limits: string[];
}

export interface ResearchReceipt {
  payload: ResearchReceiptPayload;
  integrity: {
    algorithm: "sha256";
    canonicalization: typeof RESEARCH_RECEIPT_CANONICALIZATION;
    scope: "payload";
    digest: `sha256:${string}`;
  };
}

export interface ReceiptVerification {
  valid: boolean;
  expectedDigest?: string;
  actualDigest?: string;
  reason?: string;
}
