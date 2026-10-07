import { demoteSyntheticEvidence } from "./evidence-provenance";
import { receiptAsset } from "../research-receipt-asset";
import { buildCitationExport } from "../research-citation-export";
import type { Citation, QueryRun } from "../types";
import { buildEvidenceMatrix, evidenceMatrixCsv, type EvidenceMatrixInput } from "./evidence-matrix";
import { surfaceReasoning } from "../llm/reasoning-telemetry";

/** Public recorded metadata only; no enrichment, network calls or payment authority. */
export function surfaceCitation(citation: Citation) {
  return { marker: citation.marker, sourceId: citation.sourceId, sourceName: citation.sourceName,
    source: citation.sourceName, weight: citation.weight, reward: citation.reward,
    rewardUsdc: citation.reward, rewardPlannedUsdc: citation.reward, rationale: citation.rationale, ...receiptAsset(citation) };
}

export function researchExports(run: EvidenceMatrixInput) {
  return { bibtex: buildCitationExport(run.citations, "bibtex"),
    ris: buildCitationExport(run.citations, "ris"), evidenceCsv: evidenceMatrixCsv(run) };
}

export function surfaceResearch(run: QueryRun) {
  run = demoteSyntheticEvidence(run);
  // Reuse the reading UI's exact claim/article/version and bounded-excerpt gate.
  const evidence = buildEvidenceMatrix(run).flatMap(row => row.evidence).map(item => ({
    claimIndex: item.claimIndex, claim: item.claim, marker: item.marker,
    sourceId: item.sourceId, sourceName: item.sourceName, source: item.sourceName,
    quote: item.quote, support: item.support, qualifiesForAnswer: item.qualifiesForAnswer ?? item.qualifiesForReward,
    qualifiesForReward: item.qualifiesForReward, ...receiptAsset(item),
  }));
  return { citations: run.citations.map(surfaceCitation), evidence,
    ...surfaceReasoning(run.reasoningAttempts),
    creatorsPaid: null, creatorsPaidAuthority: "distinct-settled-count-unavailable" as const,
    creatorsReferenced: new Set(run.citations.map(c => c.sourceId)).size,
    creatorRewardAllocations: new Set(run.citations.filter(c => c.sourceKind !== "public-reference" && c.reward > 0).map(c => c.sourceId)).size,
    paymentMode: run.paymentMode ?? "legacy", pendingSpendUsdc: run.pendingSpendUsdc ?? null,
    ...(run.operatingFee ? { operatingFee: { ...run.operatingFee, funding: "keryx-sponsored" as const,
      settlementAuthority: "per-payment-ledger" as const } } : {}),
    subClaims: Array.isArray(run.subClaims) ? [...run.subClaims] : [], claimCoverage: run.claimCoverage ?? [],
    researchExports: researchExports(run) };
}
