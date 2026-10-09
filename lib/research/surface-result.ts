import { demoteSyntheticEvidence } from "./evidence-provenance";
import { receiptAsset } from "../research-receipt-asset";
import { buildCitationExport } from "../research-citation-export";
import type { Citation, QueryRun } from "../types";
import { buildEvidenceMatrix, evidenceMatrixCsv, type EvidenceMatrixInput } from "./evidence-matrix";
import { surfaceReasoning } from "../llm/reasoning-telemetry";
import { projectBibliographicTask } from "./bibliographic-task-result";
import { projectTeachingProposalDelivery } from "./teaching-proposals-surface";
import { projectSourceRecencyResult } from "../sources/source-recency-result";
import { parseRunProvenance } from "./run-provenance";
import { paperReferencesCslJson } from "../papers/reference-export";

/** Public recorded metadata only; no enrichment, network calls or payment authority. */
export function surfaceCitation(citation: Citation) {
  return { marker: citation.marker, sourceId: citation.sourceId, sourceName: citation.sourceName,
    source: citation.sourceName, weight: citation.weight, reward: citation.reward,
    rewardUsdc: citation.reward, rewardPlannedUsdc: citation.reward, rationale: citation.rationale, ...receiptAsset(citation) };
}

export function researchExports(run: EvidenceMatrixInput) {
  return { bibtex: buildCitationExport(run.citations, "bibtex"),
    ris: buildCitationExport(run.citations, "ris"), cslJson: buildCitationExport(run.citations, "csl-json"), evidenceCsv: evidenceMatrixCsv(run) };
}

export function surfaceResearch(run: QueryRun) {
  run = demoteSyntheticEvidence(run);
  const bibliography = projectBibliographicTask(run.bibliography);
  const teachingProposals = projectTeachingProposalDelivery(run.teachingProposals, run);
  const sourceRecency = projectSourceRecencyResult(run.sourceRecency);
  const provenance = parseRunProvenance(run.provenance);
  // Reuse the reading UI's exact claim/article/version and bounded-excerpt gate.
  const evidence = buildEvidenceMatrix(run).flatMap(row => row.evidence).map(item => ({
    claimIndex: item.claimIndex, claim: item.claim, marker: item.marker,
    sourceId: item.sourceId, sourceName: item.sourceName, source: item.sourceName,
    quote: item.quote, support: item.support, qualifiesForAnswer: item.qualifiesForAnswer ?? item.qualifiesForReward,
    qualifiesForReward: item.qualifiesForReward, ...receiptAsset(item),
  }));
  return { citations: run.citations.map(surfaceCitation), evidence,
    ...(provenance ? { provenance } : {}),
    ...(bibliography ? { bibliography, bibliographyExports: { ...bibliography.bibliographyExports,
      cslJson: paperReferencesCslJson(bibliography.record.paper ? [bibliography.record.paper] : []) } } : {}),
    ...(teachingProposals ? { teachingProposals } : {}),
    ...(sourceRecency ? { sourceRecency } : {}),
    ...surfaceReasoning(run.reasoningAttempts, run.trace),
    creatorsPaid: null, creatorsPaidAuthority: "distinct-settled-count-unavailable" as const,
    creatorsReferenced: new Set(run.citations.map(c => c.sourceId)).size,
    creatorRewardAllocations: new Set(run.citations.filter(c => c.sourceKind !== "public-reference" && c.reward > 0).map(c => c.sourceId)).size,
    paymentMode: run.paymentMode ?? "legacy", pendingSpendUsdc: run.pendingSpendUsdc ?? null,
    ...(run.operatingFee ? { operatingFee: { ...run.operatingFee, funding: "keryx-sponsored" as const,
      settlementAuthority: "per-payment-ledger" as const } } : {}),
    subClaims: Array.isArray(run.subClaims) ? [...run.subClaims] : [], claimCoverage: run.claimCoverage ?? [],
    researchExports: researchExports(run) };
}
