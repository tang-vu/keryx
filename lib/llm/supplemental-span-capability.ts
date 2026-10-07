import { canonicalJson } from "../canonical-json";
import type { GatheredContent } from "./reasoning-engine";
import type { QuoteOption } from "./quote-options";
import type { EvidenceSpan } from "./evidence-span";

declare const spanBrand: unique symbol;
export interface SupplementalSpanCapability { readonly [spanBrand]: true }
const enrolled = new WeakMap<SupplementalSpanCapability, { sources: GatheredContent[]; options: QuoteOption[]; revalidate: () => void }>();
/** Internal runtime enrollment. No JSON field, public route or source metadata can
 * produce this object; the protected original evidence reader is its sole caller. */
export function enrollSupplementalSpans(sources: GatheredContent[], options: QuoteOption[], revalidate: () => void): SupplementalSpanCapability {
  const capability = Object.freeze({}) as SupplementalSpanCapability;
  enrolled.set(capability, { sources: structuredClone(sources), options: structuredClone(options), revalidate }); return capability;
}
export function isSupplementaryStructuredSpan(capability: SupplementalSpanCapability | undefined,
  source: GatheredContent, quote: string, span: EvidenceSpan | undefined): boolean {
  const value = capability && enrolled.get(capability);
  if (!value || !span) return false; value.revalidate();
  return value.sources.some(item => canonicalJson(item) === canonicalJson(source)) && value.options.some(option =>
    option.sourceId === source.sourceId && option.marker === source.marker && option.contentVersion === source.contentVersion &&
    option.start === span.start && option.end === span.end && option.text === quote && source.text.slice(span.start, span.end) === quote);
}
