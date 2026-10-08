import { fulfillmentObjectSha256, type A2aFulfillmentClaim, type FulfillmentCompletionInput } from "./fulfillment-authority";
export { fulfillmentInputSchema, fulfillmentAuthoritySchema, fulfillmentClaimInputSchema, fulfillmentCompletionInputSchema, fulfillmentSha256, fulfillmentObjectSha256, failedOriginalEvidenceSha256, matchesFailedFulfillmentOriginal } from "./fulfillment-authority";
export type { FulfillmentInput, FulfillmentAuthority, FulfillmentClaimInput, A2aFulfillmentClaim, FulfillmentCompletionInput, A2aFulfillmentCompletion, A2aFulfillmentRecord } from "./fulfillment-authority";
import { z } from "zod";
import { canonicalJson } from "../canonical-json";
import { MAX_RESEARCH_TARGETS } from "../llm/research-target-limits";
import type { QueryRun } from "../types";
import { renderFulfilledOriginalAnswer, type FulfillmentEvidenceGap } from "./original-fulfillment-answer";
import { supplementalRunSources, supplementalRunQuoteOptions, type FulfillmentEvidenceCapability } from "./fulfillment-supplement-evidence";
import type { GatheredContent } from "../llm/reasoning-engine";
import { ORIGINAL_FULFILLMENT_QUALITY_PROTOCOL, type OriginalFulfillmentQualityProtocol } from "../llm/original-fulfillment-quality";
export { ORIGINAL_FULFILLMENT_LIMITS } from "./fulfillment-limits";

const timestamp = z.string().datetime().refine(value => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);

export const fulfillmentEvidenceGapsSchema = z.array(z.object({
  claimIndex: z.number().int().min(0).max(MAX_RESEARCH_TARGETS - 1),
  missingRequestedParts: z.array(z.string().trim().min(1).max(500)
    .refine(value => [...value].every(character => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127), "Gap control characters refused"))
    .min(1).max(8),
}).strict()).max(MAX_RESEARCH_TARGETS).refine(value => value.every((item, index) =>
  (index === 0 || value[index - 1].claimIndex < item.claimIndex) &&
  new Set(item.missingRequestedParts).size === item.missingRequestedParts.length), "Duplicate or unordered evidence gaps");

/** Private provenance stored with the new result. Historical failed execution/cost stays explicit. */
interface FulfilledOriginalRunMetadataBase {
  claimId: string; authoritySha256: string; inputSha256: string;
  originalFailureSha256: string; providerLedgerSha256: string;
  originalProviderBilling: "unknown"; noNewInboundPayment: true;
  statements: import("../agent/cited-statements").CitedStatement[];
  evidenceGaps: FulfillmentEvidenceGap[];
}
export type FulfilledOriginalRunMetadata = FulfilledOriginalRunMetadataBase & ({
  format: "keryx-a2a-original-fulfillment-result-v1";
} | {
  format: "keryx-a2a-original-fulfillment-result-v2";
  supplementaryInputSha256: string; contextSha256: string;
  qualityProtocol?: OriginalFulfillmentQualityProtocol;
  statementReviews: Array<import("../agent/cited-statements").CitedStatement & { support: number }>;
});
export function validateFulfilledQueryRun(run: QueryRun, claim: A2aFulfillmentClaim,
  completion: FulfillmentCompletionInput, evidenceCapability?: FulfillmentEvidenceCapability): void {
  const metadata = run.originalFulfillment;
  if (metadata && "qualityProtocol" in metadata && metadata.qualityProtocol !== undefined &&
      (metadata.format !== "keryx-a2a-original-fulfillment-result-v2" ||
        metadata.qualityProtocol !== ORIGINAL_FULFILLMENT_QUALITY_PROTOCOL))
    throw new Error("Failed original fulfillment quality protocol refused");
  const supplementalSources = metadata?.format === "keryx-a2a-original-fulfillment-result-v2"
    ? supplementalRunSources(run, claim, evidenceCapability) : undefined;
  if (completion.originalId !== claim.authority.original.id || completion.claimId !== claim.claimId ||
    run.id !== claim.authority.original.queryId || run.question !== claim.authority.question ||
    run.budget !== 0.01 || run.engine !== "llm:deepseek:deepseek-v4-flash" ||
    run.researchMode !== "quick" || run.origin !== "a2a" || run.paymentMode !== "real" ||
    run.totalSpent !== 0 || run.totalToCreators !== 0 || run.pendingSpendUsdc !== 0 ||
    run.paymentAttempts !== 0 || run.settledPayments !== 0 || run.pendingPayments !== 0 ||
    run.parentId !== undefined || run.retryOf !== undefined || !run.answer?.trim() ||
    !Array.isArray(run.subClaims) || canonicalJson(run.subClaims) !== canonicalJson(claim.authority.input.targets) ||
    !metadata || !["keryx-a2a-original-fulfillment-result-v1", "keryx-a2a-original-fulfillment-result-v2"].includes(metadata.format) || metadata.claimId !== claim.claimId ||
    metadata.authoritySha256 !== fulfillmentObjectSha256(claim.authority) ||
    metadata.inputSha256 !== fulfillmentObjectSha256(claim.authority.input) ||
    metadata.originalFailureSha256 !== claim.authority.originalEvidenceSha256 ||
    metadata.providerLedgerSha256 !== completion.providerLedgerSha256 || metadata.originalProviderBilling !== "unknown" ||
    metadata.noNewInboundPayment !== true || !Array.isArray(metadata.statements) || metadata.statements.length === 0 ||
    !timestamp.safeParse(run.createdAt).success || Date.parse(run.createdAt) < Date.parse(claim.claimedAt) ||
    run.durationMs !== undefined && run.durationMs !== Date.parse(run.createdAt) - Date.parse(claim.failedOrder.startedAt!) ||
    Date.parse(completion.completedAt) < Date.parse(run.createdAt) || fulfillmentObjectSha256(run) !== completion.runSha256)
    throw new Error("Failed original fulfillment result refused");
  const citations = run.citations, evidence = run.evidence, coverage = run.claimCoverage;
  const gaps = fulfillmentEvidenceGapsSchema.safeParse(metadata.evidenceGaps);
  if (!gaps.success || canonicalJson(gaps.data) !== canonicalJson(metadata.evidenceGaps) ||
    gaps.data.some(gap => gap.claimIndex >= run.subClaims.length)) throw new Error("Failed original fulfillment gaps refused");
  const selectedIds = supplementalSources?.map(source => source.sourceId) ?? claim.authority.input.selectedDocumentIds.map(id => `public:fulfillment:${id}`);
  const selected = new Set(selectedIds);
  if (!Array.isArray(citations) || citations.length < 1 || citations.length > selectedIds.length ||
    new Set(citations.map(item => item.marker)).size !== citations.length ||
    new Set(citations.map(item => item.sourceId)).size !== citations.length ||
    citations.some(item => item.sourceKind !== "public-reference" || item.reward !== 0 || !selected.has(item.sourceId) ||
      item.marker !== `S${selectedIds.indexOf(item.sourceId) + 1}` || !Number.isFinite(item.weight) || item.weight < 0 || item.weight > 1) ||
    !Array.isArray(evidence) || !evidence.some(item => item.qualifiesForAnswer === true) ||
    evidence.some(item => item.sourceKind !== "public-reference" || item.qualifiesForReward !== false ||
      !Number.isInteger(item.claimIndex) || item.claimIndex < 0 || item.claimIndex >= run.subClaims.length ||
      item.claim !== run.subClaims[item.claimIndex] || typeof item.quote !== "string" || !item.quote.trim() ||
      !Number.isFinite(item.support) || item.support < 0 || item.support > 1 ||
      !selected.has(item.sourceId) || item.marker !== `S${selectedIds.indexOf(item.sourceId) + 1}` ||
      item.qualifiesForAnswer === true && !citations.some(citation => citation.marker === item.marker && citation.sourceId === item.sourceId && citation.sourceName === item.sourceName)) ||
    citations.some(citation => !evidence.some(item => item.qualifiesForAnswer === true && item.marker === citation.marker)) ||
    !Array.isArray(coverage) || coverage.length !== run.subClaims.length || coverage.some((item, index) =>
      item.claimIndex !== index || item.claim !== run.subClaims[index] || !Number.isFinite(item.coverage) ||
      item.coverage < 0 || item.coverage > 1 || !Array.isArray(item.coveredBy) ||
      new Set(item.coveredBy).size !== item.coveredBy.length || item.coveredBy.some(marker =>
        !evidence.some(e => e.claimIndex === index && e.marker === marker && e.qualifiesForAnswer === true)) ||
      item.coverage > Math.max(0, ...evidence.filter(e => e.claimIndex === index && e.qualifiesForAnswer === true).map(e => e.support))))
    throw new Error("Failed original fulfillment evidence refused");
  if (supplementalSources && metadata.format === "keryx-a2a-original-fulfillment-result-v2") {
    // A serialized quality flag grants no evidence authority. Reconstruct its
    // exact original-source spans through the protected run/claim capability.
    if (metadata.qualityProtocol) supplementalRunQuoteOptions(run, claim, evidenceCapability);
    const matchesSource = (item: typeof citations[number] | typeof evidence[number], source: GatheredContent) =>
      item.marker === source.marker && item.sourceId === source.sourceId && item.sourceName === source.sourceName &&
      item.itemId === source.itemId && item.itemTitle === source.itemTitle && item.itemUrl === source.itemUrl &&
      item.contentVersion === source.contentVersion && canonicalJson(item.webProvenance) === canonicalJson(source.webProvenance) &&
      canonicalJson(item.requestedSource) === canonicalJson(source.requestedSource);
    if (citations.some(item => item.weight !== 0 || !supplementalSources.some(source => matchesSource(item, source))) ||
      evidence.some(item => !supplementalSources.some(source => matchesSource(item, source) &&
        item.quote.length >= 8 && item.quote.length <= 240 && source.text.includes(item.quote))) ||
      !Array.isArray(metadata.statementReviews) || metadata.statementReviews.length !== metadata.statements.length ||
      metadata.statements.some((statement, index) => {
        const review = metadata.statementReviews[index];
        return !review || !Number.isFinite(review.support) || review.support < 0.7 || review.support > 1 ||
          canonicalJson({ claimIndex: review.claimIndex, marker: review.marker, quote: review.quote, text: review.text }) !== canonicalJson(statement);
      }) || claim.authority.input.targets.some((_, index) => (coverage[index]?.coverage ?? 0) < 0.4 ||
        !metadata.statements.some(statement => statement.claimIndex === index)))
      throw new Error("Failed original supplemental provenance or review refused");
  }
  for (const statement of metadata.statements) {
    if (!Number.isInteger(statement.claimIndex) || statement.claimIndex < 0 || statement.claimIndex >= run.subClaims.length ||
      typeof statement.text !== "string" || !statement.text.trim() ||
      !evidence.some(item => item.qualifiesForAnswer === true && item.claimIndex === statement.claimIndex &&
        item.marker === statement.marker && item.quote === statement.quote))
      throw new Error("Failed original fulfillment statement refused");
  }
  // Reuse the real delivered renderer: technical Markdown/citation literals may
  // be escaped, and every unsupported frozen target must remain a visible gap.
  if (run.answer !== renderFulfilledOriginalAnswer({ question: run.question, answer: "", statements: metadata.statements,
    evidenceGaps: metadata.evidenceGaps,
    qualityProtocol: metadata.format === "keryx-a2a-original-fulfillment-result-v2" ? metadata.qualityProtocol : undefined,
    ledger: { evidence, claimCoverage: coverage, acceptedMarkers: new Set(citations.map(item => item.marker)),
      droppedEvidence: 0, droppedCitations: [] } })) throw new Error("Failed original fulfillment delivery refused");
}
