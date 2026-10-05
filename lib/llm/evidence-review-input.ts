import type { GatheredContent, ProposedEvidence } from "./reasoning-engine";
import type { QuoteOption } from "./quote-options";
import { isCompleteEvidenceSpan } from "./evidence-span";
import { EVIDENCE_REVIEW_GUIDANCE, MAX_REVIEWED_EVIDENCE } from "./evidence-review";

export const MAX_EVIDENCE_REVIEW_INPUT_BYTES = 32_000;
// Bound both authored messages and reserve framing space; provider transport
// policies remain separate and may impose a smaller cap. Never raise those caps.
const REVIEW_FRAMING_BYTES = 1024;
const schema = '{"reviews":[{"index":number,"supportedFact":string,"support":number(0..1)}]}';

/** Build the private verifier input. Unbound/over-budget rows never gain review authority. */
export function buildEvidenceReviewInput(input: {
  proposals: ProposedEvidence[];
  options: QuoteOption[];
  gathered: GatheredContent[];
  subClaims: string[];
}): { json: string; reviewedIndexes: ReadonlySet<number> } {
  const sources = new Map(input.gathered.map(source => [source.marker, source]));
  const ids = new Set(input.options.map(option => option.quoteId));
  if (sources.size !== input.gathered.length || ids.size !== input.options.length) {
    throw new Error("Ambiguous evidence review binding");
  }
  const evidence: object[] = [];
  const reviewedIndexes = new Set<number>();
  for (const [index, proposal] of input.proposals.slice(0, MAX_REVIEWED_EVIDENCE).entries()) {
    const source = sources.get(proposal.marker);
    const target = input.subClaims[proposal.claimIndex];
    if (!source || !Number.isInteger(proposal.claimIndex) || typeof target !== "string" ||
        !isCompleteEvidenceSpan(source, proposal.quote, proposal.quoteSpan)) continue;
    const matches = input.options.filter(option => option.marker === proposal.marker &&
      option.start === proposal.quoteSpan!.start && option.end === proposal.quoteSpan!.end);
    if (matches.length !== 1) continue;
    const option = matches[0];
    if (option.sourceId !== source.sourceId || option.itemUrl !== source.itemUrl ||
        option.contentVersion !== source.contentVersion || option.text !== proposal.quote ||
        !Number.isSafeInteger(option.contextStart) || !Number.isSafeInteger(option.contextEnd) ||
        option.contextStart < 0 || option.contextEnd > Math.min(source.text.length, 200_000) ||
        option.contextStart > option.start || option.contextEnd < option.end ||
        option.contextEnd - option.contextStart > 1200 ||
        source.text.slice(option.contextStart, option.contextEnd) !== option.context ||
        option.prefixOmitted !== (option.contextStart > 0) || option.suffixOmitted !== (option.contextEnd < source.text.length)) continue;
    const entry = {
      index, question: target, quote: proposal.quote, quoteId: option.quoteId,
      source: { marker: source.marker, sourceId: source.sourceId, name: source.sourceName,
        itemUrl: source.itemUrl, contentVersion: source.contentVersion,
        sourceKind: source.sourceKind ?? "creator",
        deliveryKind: source.publicDeliveryKind ?? source.contentReceipt?.deliveryKind ?? "unknown",
        ...(source.webProvenance ? { webProvenance: {
          normalizedBodyHash: source.webProvenance.normalizedBodyHash,
          retrievedAt: source.webProvenance.retrievedAt,
          extraction: source.webProvenance.extraction,
          truncated: source.webProvenance.truncated,
        } } : {}),
      },
      quoteSpan: proposal.quoteSpan,
      context: { start: option.contextStart, end: option.contextEnd, text: option.context,
        prefixOmitted: option.prefixOmitted, suffixOmitted: option.suffixOmitted },
    };
    if (Buffer.byteLength(JSON.stringify({ evidence: [...evidence, entry], schema }), "utf8") +
        Buffer.byteLength(EVIDENCE_REVIEW_GUIDANCE, "utf8") + REVIEW_FRAMING_BYTES > MAX_EVIDENCE_REVIEW_INPUT_BYTES) continue;
    evidence.push(entry);
    reviewedIndexes.add(index);
  }
  return { json: JSON.stringify({ evidence, schema }), reviewedIndexes };
}
