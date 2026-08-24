/**
 * Portable, integrity-checkable projection of one completed Keryx dispatch.
 *
 * This is a read model. It cannot authorize payment, replace registry payout authority, reveal
 * paid plaintext, or turn a pending/simulated row into settled money.
 */

import { deriveConfidence } from "./agent/confidence";
import { receiptAsset } from "./research-receipt-asset";
import { researchReceiptDigest, sha256 } from "./research-receipt-integrity";
import { micros, projectReceiptSettlement } from "./research-receipt-settlement";
import {
  RESEARCH_RECEIPT_CANONICALIZATION,
  RESEARCH_RECEIPT_SCHEMA,
  type ReceiptClaim,
  type ReceiptDecision,
  type ReceiptEvidence,
  type ReceiptEvidencePortfolio,
  type ResearchReceipt,
  type ResearchReceiptPayload,
} from "./research-receipt-types";
import type { Decision, EvidenceRecord, PaymentRecord, QueryRun } from "./types";

export {
  canonicalJson,
  researchReceiptDigest,
  verifyResearchReceipt,
} from "./research-receipt-integrity";
export {
  RESEARCH_RECEIPT_CANONICALIZATION,
  RESEARCH_RECEIPT_SCHEMA,
} from "./research-receipt-types";
export type {
  ReceiptCreatorPayment,
  ReceiptDecision,
  ReceiptEvidence,
  ReceiptEvidencePortfolio,
  ReceiptLedgerCompleteness,
  ReceiptPaymentStatus,
  ReceiptSettlement,
  ReceiptSettlementStatus,
  ReceiptVerification,
  ResearchReceipt,
  ResearchReceiptPayload,
} from "./research-receipt-types";

function projectEvidencePortfolio(
  portfolio: NonNullable<QueryRun["evidencePortfolio"]>,
): ReceiptEvidencePortfolio {
  return {
    policy: portfolio.policy,
    eligibleCandidates: portfolio.eligibleCandidates,
    attentionLimit: portfolio.attentionLimit,
    fetchBudgetUsdc: micros(portfolio.fetchBudgetUsdc),
    selectedAssetIds: [...portfolio.selectedAssetIds],
    selectedBuyUsdc: micros(portfolio.selectedBuyUsdc),
    unusedFetchBudgetUsdc: micros(portfolio.unusedFetchBudgetUsdc),
    predictedCoveredClaims: portfolio.predictedCoveredClaims,
    claims: portfolio.claims.map((claim) => ({
      claimIndex: claim.claimIndex,
      selectedCandidateIds: [...claim.selectedCandidateIds],
      predictedCoverage: claim.predictedCoverage,
    })),
    ...(portfolio.outcome
      ? {
          outcome: {
            readAssetIds: [...portfolio.outcome.readAssetIds],
            evidenceAssetIds: [...portfolio.outcome.evidenceAssetIds],
            nonqualifyingReads: portfolio.outcome.nonqualifyingReads,
            unreadSelected: portfolio.outcome.unreadSelected,
            groundedClaims: portfolio.outcome.groundedClaims,
            evidenceYield: portfolio.outcome.evidenceYield,
          },
        }
      : {}),
  };
}

function projectDecision(decision: Decision): ReceiptDecision {
  return {
    sourceId: decision.sourceId,
    sourceName: decision.sourceName,
    action: decision.action,
    expectedValue: decision.expectedValue,
    priceUsdc: decision.price,
    ...(decision.listPrice !== undefined ? { listPriceUsdc: decision.listPrice } : {}),
    ...(decision.offerId ? { offerId: decision.offerId } : {}),
    confidence: decision.confidence,
    rationale: decision.rationale,
    targets: Array.isArray(decision.targets) ? [...decision.targets] : [],
    external: decision.external === true,
    ...receiptAsset(decision),
  };
}

function projectEvidence(evidence: EvidenceRecord): ReceiptEvidence {
  return {
    marker: evidence.marker,
    sourceId: evidence.sourceId,
    sourceName: evidence.sourceName,
    quote: evidence.quote,
    support: evidence.support,
    qualifiesForReward: evidence.qualifiesForReward,
    ...receiptAsset(evidence),
  };
}

function projectClaims(run: QueryRun): ReceiptClaim[] {
  const coverage = new Map(
    (run.claimCoverage ?? []).map((claim) => [claim.claimIndex, claim]),
  );
  const evidence = run.evidence ?? [];
  return run.subClaims.map((claim, claimIndex) => {
    const measured = coverage.get(claimIndex);
    return {
      claimIndex,
      claim,
      coverage: measured?.coverage ?? null,
      coveredBy: measured ? [...measured.coveredBy] : [],
      evidence: evidence
        .filter((item) => item.claimIndex === claimIndex)
        .map(projectEvidence),
    };
  });
}

export function buildResearchReceipt(run: QueryRun, payments: PaymentRecord[]): ResearchReceipt {
  const confidence = deriveConfidence(run);
  const payload: ResearchReceiptPayload = {
    schema: RESEARCH_RECEIPT_SCHEMA,
    dispatch: {
      id: run.id,
      question: run.question,
      answer: run.answer,
      answerSha256: sha256(run.answer),
      createdAt: run.createdAt,
      budgetUsdc: micros(run.budget),
      researchMode: run.researchMode ?? "deep",
      engine: run.engine,
      confidence: confidence ? { ...confidence } : null,
    },
    agency: {
      decisions: run.decisions.map(projectDecision),
      ...(run.evidencePortfolio
        ? { evidencePortfolio: projectEvidencePortfolio(run.evidencePortfolio) }
        : {}),
    },
    claims: projectClaims(run),
    citations: run.citations.map((citation) => ({
      marker: citation.marker,
      sourceId: citation.sourceId,
      sourceName: citation.sourceName,
      weight: citation.weight,
      rewardPlannedUsdc: micros(citation.reward),
      rationale: citation.rationale,
      ...receiptAsset(citation),
    })),
    settlement: projectReceiptSettlement(run, payments),
    limits: [
      "The SHA-256 detects payload changes when its original digest is retained separately; the self-check alone is not a Keryx or creator signature.",
      "Only creator payment rows carrying Circle settlement evidence appear in settled totals.",
      "Circle Gateway transfer ids are settlement references, not per-payment Arc transaction hashes.",
      "The settlement snapshot may change if exact Circle reconciliation resolves a pending authorization.",
      "The receipt contains public evidence excerpts and metadata, never paid plaintext or signing authority.",
    ],
  };

  return {
    payload,
    integrity: {
      algorithm: "sha256",
      canonicalization: RESEARCH_RECEIPT_CANONICALIZATION,
      scope: "payload",
      digest: researchReceiptDigest(payload),
    },
  };
}
