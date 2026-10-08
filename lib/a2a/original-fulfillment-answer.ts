import { finalizeGroundedAnswer } from "../agent/answer-grounding";
import { researchResponseLanguage } from "../agent/empty-public-evidence";
import { assertOriginalFulfillmentQuality, originalFulfillmentAcceptanceChecks,
  ORIGINAL_FULFILLMENT_QUALITY_PROTOCOL, type OriginalFulfillmentQualityProtocol } from "../llm/original-fulfillment-quality";

/** Missing requested details are assessment data, never new factual conclusions. */
export interface FulfillmentEvidenceGap { claimIndex: number; missingRequestedParts: string[] }

function literal(value: string): string {
  return value.replace(/[`*_\[\]()<>]/g, "$&\u200b");
}

/** Preserve the admitted cited-summary renderer and separately show missing parts of a
 * partially supported target. The raw draft and sufficiency prose are never delivered. */
export function renderFulfilledOriginalAnswer(input: Parameters<typeof finalizeGroundedAnswer>[0] & {
  evidenceGaps: FulfillmentEvidenceGap[];
  qualityProtocol?: OriginalFulfillmentQualityProtocol;
}): string {
  if (input.qualityProtocol !== undefined && input.qualityProtocol !== ORIGINAL_FULFILLMENT_QUALITY_PROTOCOL)
    throw new Error("Unknown original fulfillment quality protocol");
  if (input.qualityProtocol) assertOriginalFulfillmentQuality({ question: input.question,
    targets: input.ledger.claimCoverage.map(claim => claim.claim), statements: input.statements ?? [] });
  const answer = [finalizeGroundedAnswer(input), ...(input.qualityProtocol ? [originalFulfillmentAcceptanceChecks()] : [])].join("\n\n");
  if (!input.evidenceGaps.length) return answer;
  const vi = researchResponseLanguage(input.question) === "vi";
  const heading = vi ? "### Phần bằng chứng còn thiếu theo đánh giá của mô hình" : "### Requested evidence gaps from the model assessment";
  const explanation = vi
    ? "Các chi tiết được yêu cầu dưới đây chưa được xác minh; chúng không phải kết luận đã được chứng minh."
    : "The requested details below remain unverified; they are not established conclusions.";
  const rows = input.evidenceGaps.map(gap => [
    `${vi ? "Yêu cầu nghiên cứu" : "Research target"} ${gap.claimIndex + 1}:`,
    ...gap.missingRequestedParts.map(part => `- ${literal(part)}`),
  ].join("\n"));
  return [answer, heading, explanation, ...rows].join("\n\n");
}
