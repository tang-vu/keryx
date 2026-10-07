import type { GatheredContent } from "./reasoning-engine";

export type SourceExtraction = NonNullable<GatheredContent["webProvenance"]>["extraction"];
const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

/** Boundary view only. Every CR/LF occupies one UTF-16 position in both views;
 * callers must slice the original text, never return this view as a quotation.
 * Observed PDF extraction has physical line wraps, not verified paragraph breaks.
 * This does not establish reading order, semantic independence or complete context.
 */
export function sourceSentenceSegments(text: string, extraction?: SourceExtraction) {
  return segmenter.segment(extraction === "pdf" ? text.replace(/[\r\n]/g, " ") : text);
}
