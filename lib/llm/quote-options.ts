import type { GatheredContent, ProposedEvidence } from "./reasoning-engine";
import type { evidenceContext } from "./evidence-context";
import { buildContextualQuoteOptions, type ContextualQuoteOption } from "./quote-context";
import { normalizeStatement } from "./cited-statement";
import { observeQuotePresentationItems, bindQuotePresentationSpan } from "./quote-presentation-item";

/** Private binding/context; generation receives only quoteId, marker and text. */
export interface QuoteOption extends ContextualQuoteOption {
  sourceId: string;
  itemUrl?: string;
  contentVersion?: string;
}

/** Whole, bounded sentences from exact already-unlocked source spans. */
export function buildQuoteOptions(sources: ReturnType<typeof evidenceContext>, gathered: GatheredContent[],
  policy: { includeShortBlocks?: boolean } = {}): QuoteOption[] {
  const options = buildContextualQuoteOptions(sources, gathered, { completeSentencesOnly: true, includeShortBlocks: policy.includeShortBlocks });
  const bound = options.map(option => {
    const original = gathered.find(source => source.marker === option.marker)!;
    return { ...option, sourceId: original.sourceId, itemUrl: original.itemUrl, contentVersion: original.contentVersion };
  });
  if (policy.includeShortBlocks === true) observeQuotePresentationItems(bound, gathered);
  return bound;
}

/** Invalid selections stay invalid proposals so the existing ledger records their rejection. */
export function resolveQuoteEvidence(value: unknown, options: QuoteOption[]): ProposedEvidence[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map(options.map((option) => [option.quoteId, option]));
  if (byId.size !== options.length) return [];
  return value.map((raw) => {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const marker = typeof item.marker === "string" ? item.marker : "";
    const option = typeof item.quoteId === "string" ? byId.get(item.quoteId) : undefined;
    const bound = option?.marker === marker ? option : undefined;
    const support = Number(item.support);
    // A sentence without its exact server-resolved quote has nothing to be checked against.
    const statement = bound ? normalizeStatement(item.statement) : undefined;
    const quoteSpan = bound ? { start: bound.start, end: bound.end } : undefined;
    if (bound && quoteSpan) bindQuotePresentationSpan(bound, quoteSpan);
    return {
      ...(statement ? { statement } : {}),
      claimIndex: typeof item.claimIndex === "number" ? item.claimIndex : NaN,
      marker,
      quote: bound?.text ?? "",
      ...(quoteSpan ? { quoteSpan } : {}),
      support: Number.isFinite(support) ? Math.max(0, Math.min(1, support)) : 0,
    };
  });
}
