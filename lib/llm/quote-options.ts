import type { ProposedEvidence } from "./reasoning-engine";

export interface QuoteOption { quoteId: string; marker: string; text: string }
const MAX_QUOTE_CHARACTERS = 240;
const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

/** A bounded menu from the supplied, already-unlocked passages. Never joins across gaps. */
export function buildQuoteOptions(sources: { marker: string; passages: { text: string }[] }[]): QuoteOption[] {
  return sources.flatMap((source, sourceIndex) => {
    const options: QuoteOption[] = [];
    for (const passage of source.passages) {
      for (const sentence of segmenter.segment(passage.text)) {
        const body = sentence.segment.trim();
        let start = 0;
        while (start < body.length && options.length < 64) {
          let end = Math.min(body.length, start + MAX_QUOTE_CHARACTERS);
          if (end < body.length) {
            const space = body.lastIndexOf(" ", end);
            if (space >= start + 8) end = space;
            // Do not cut a surrogate pair in text without word boundaries.
            else if (/[\uD800-\uDBFF]/.test(body[end - 1])) end--;
          }
          const text = body.slice(start, end).trim();
          if (text.length >= 8) options.push({ quoteId: `q${sourceIndex}_${options.length}`, marker: source.marker, text });
          if (end === body.length) break;
          // Overlap the previous bounded quote so a mechanism straddling its edge can be
          // selected as one literal span. Never concatenate text from separate passages.
          const next = start + Math.max(1, Math.floor((end - start) / 2));
          const space = body.indexOf(" ", next);
          start = space >= next && space < end ? space + 1 : next;
          if (/[\uDC00-\uDFFF]/.test(body[start])) start++;
        }
      }
    }
    return options;
  });
}

/** Invalid selections stay invalid proposals so the existing ledger records their rejection. */
export function resolveQuoteEvidence(value: unknown, options: QuoteOption[]): ProposedEvidence[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map(options.map((option) => [option.quoteId, option]));
  return value.map((raw) => {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const marker = typeof item.marker === "string" ? item.marker : "";
    const option = typeof item.quoteId === "string" ? byId.get(item.quoteId) : undefined;
    const support = Number(item.support);
    return {
      claimIndex: typeof item.claimIndex === "number" ? item.claimIndex : NaN,
      marker,
      quote: option?.marker === marker ? option.text : "",
      support: Number.isFinite(support) ? Math.max(0, Math.min(1, support)) : 0,
    };
  });
}
