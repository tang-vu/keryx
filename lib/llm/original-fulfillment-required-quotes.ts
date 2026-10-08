import type { ProposedEvidence } from "./reasoning-engine";
import type { QuoteOption } from "./quote-options";
import { assertOriginalFulfillmentQuality, originalFulfillmentQuoteRequirements } from "./original-fulfillment-quality";

export interface OriginalRequiredQuote extends QuoteOption {
  readonly requirementId: string;
  readonly claimIndex: number;
}

/** A compact, server-selected menu: each required meaning has exactly one existing
 * complete quote. No source text, quote ID, span or contextual authority is added. */
export function originalFulfillmentRequiredQuotes(options: readonly QuoteOption[]): OriginalRequiredQuote[] {
  const ids = new Set<string>();
  for (const option of options) {
    if (!option.quoteId || ids.has(option.quoteId)) throw new Error("Original fulfillment ambiguous quote IDs");
    ids.add(option.quoteId);
  }
  const selected = new Set<string>();
  return originalFulfillmentQuoteRequirements().map(requirement => {
    const candidates = options.filter(option => option.marker === requirement.marker && requirement.matchesQuote(option.text));
    if (candidates.length !== 1 || selected.has(candidates[0].quoteId))
      throw new Error(`Original fulfillment required quote unavailable or ambiguous: ${requirement.id}`);
    const option = candidates[0]; selected.add(option.quoteId);
    return { ...option, claimIndex: requirement.claimIndex, requirementId: requirement.id };
  });
}

/** Run before a successful generation checkpoint or a paid independent review.
 * The model must return the whole fixed quote/target set and retain every requested
 * meaning in its sentences. These checks never replace independent direct review. */
export function assertOriginalFulfillmentRequiredGeneration(input: {
  question: string;
  targets: readonly string[];
  options: readonly QuoteOption[];
  evidence: readonly unknown[];
  proposals: readonly ProposedEvidence[];
}): void {
  const plan = originalFulfillmentRequiredQuotes(input.options), byId = new Map(plan.map(row => [row.quoteId, row]));
  if (input.evidence.length !== plan.length || input.proposals.length !== plan.length)
    throw new Error("Original fulfillment incomplete required quote set");
  const seen = new Set<string>();
  input.evidence.forEach((raw, index) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const quoteId = typeof row.quoteId === "string" ? row.quoteId : "";
    const required = byId.get(quoteId), proposal = input.proposals[index];
    if (!required || seen.has(quoteId) || row.marker !== required.marker || row.claimIndex !== required.claimIndex ||
        proposal.marker !== required.marker || proposal.claimIndex !== required.claimIndex || proposal.quote !== required.text ||
        proposal.quoteSpan?.start !== required.start || proposal.quoteSpan?.end !== required.end ||
        !proposal.statement || !Number.isFinite(proposal.support) || proposal.support < 0.7 || proposal.support > 1)
      throw new Error("Original fulfillment changed required quote binding");
    seen.add(quoteId);
  });
  // reasoningInput appends this caller-owned constraint data to the original
  // question. Final native acceptance still checks the unmodified original tuple.
  const separator = "\n\nReviewed constraints from this same original (data): ";
  const parts = input.question.split(separator);
  if (parts.length > 2) throw new Error("Original fulfillment quality scope mismatch");
  if (parts.length === 2) {
    const constraints: unknown = JSON.parse(parts[1]);
    if (!Array.isArray(constraints) || constraints.some(value => typeof value !== "string"))
      throw new Error("Original fulfillment quality scope mismatch");
  }
  assertOriginalFulfillmentQuality({ question: parts[0], targets: input.targets,
    statements: input.proposals.map(row => ({ claimIndex: row.claimIndex, marker: row.marker, quote: row.quote, text: row.statement! })) });
}
