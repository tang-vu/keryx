import { buildEvidenceReviewInput, MAX_EVIDENCE_REVIEW_INPUT_BYTES } from "./evidence-review-input";
import { EVIDENCE_REVIEW_GUIDANCE, MAX_REVIEWED_EVIDENCE } from "./evidence-review";

/** The private complete-answer reviewer receives each exact full source once.
 * Rows retain the normal deterministic quote/span/context admission gates; only
 * repeated transport data is removed. No source or proposed row is truncated to
 * fit, and the ordinary review packet remains unchanged. */
export function buildOriginalFulfillmentQualityReviewInput(input: Parameters<typeof buildEvidenceReviewInput>[0]): ReturnType<typeof buildEvidenceReviewInput> {
  if (!input.proposals.length || input.proposals.length > MAX_REVIEWED_EVIDENCE)
    throw new Error("Original fulfillment complete-review row bound exceeded");
  const evidence: object[] = [];
  const sources = new Map<string, object>();
  const targets = new Map<number, { claimIndex: number; question: string }>();
  const reviewedIndexes = new Set<number>();
  let schema: string | undefined;
  for (const [index, proposal] of input.proposals.entries()) {
    // Reuse every existing private quote, original offset, provenance and complete
    // span check. A single inadmissible row refuses the entire private packet.
    const single = buildEvidenceReviewInput({ ...input, proposals: [proposal] });
    if (single.reviewedIndexes.size !== 1) throw new Error("Original fulfillment incomplete review binding");
    const packet = JSON.parse(single.json) as { evidence: Array<Record<string, unknown>>; schema: string };
    // quoteId is an internal menu-selection key already resolved above. The
    // reviewer receives the exact quote/span/source binding and stable row index.
    const { source, context: _context, question, quoteId: _quoteId, ...row } = packet.evidence[0];
    if (question !== input.subClaims[proposal.claimIndex]) throw new Error("Original fulfillment review target binding changed");
    targets.set(proposal.claimIndex, { claimIndex: proposal.claimIndex, question: question as string });
    const gathered = input.gathered.find(item => item.marker === proposal.marker)!;
    const sourceRecord = source as Record<string, unknown>;
    const key = proposal.marker;
    if (!sources.has(key)) sources.set(key, { ...sourceRecord, context: { text: gathered.text } });
    evidence.push({ ...row, index, claimIndex: proposal.claimIndex, sourceRef: key });
    reviewedIndexes.add(index);
    schema = packet.schema;
  }
  const json = JSON.stringify({ guidance: "claimIndex maps to researchTargets; sourceRef maps to sources. Context is the complete retained body; provenance still records extraction truncation. Judge the exact quote and statement; context cannot supply a missing assertion.",
    evidence, researchTargets: [...targets.values()].sort((a, b) => a.claimIndex - b.claimIndex), sources: [...sources.values()], schema });
  const inputBytes = Buffer.byteLength(json + EVIDENCE_REVIEW_GUIDANCE, "utf8") + 1024;
  if (inputBytes > MAX_EVIDENCE_REVIEW_INPUT_BYTES)
    throw new Error(`Original fulfillment complete-review input bound exceeded (${inputBytes} bytes)`);
  return { json, reviewedIndexes };
}
