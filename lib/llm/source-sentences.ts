import type { GatheredContent } from "./reasoning-engine";
import type { HtmlTextLayout } from "../web-research/html-text-layout";
import { sourceTextBlocks } from "./source-text-blocks";

export type SourceExtraction = NonNullable<GatheredContent["webProvenance"]>["extraction"];
const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });

/** Boundary view only. Every CR/LF occupies one UTF-16 position in both views;
 * callers must slice the original text, never return this view as a quotation.
 * Observed PDF extraction has physical line wraps, not verified paragraph breaks.
 * This does not establish reading order, semantic independence or complete context.
 */
export function sourceSentenceSegments(text: string, extraction?: SourceExtraction, layout?: HtmlTextLayout) {
  let view = extraction === "pdf" ? text.replace(/[\r\n]/g, " ") : text;
  if (extraction === "html" && layout?.preformatted.length) {
    const parts: string[] = [];
    let cursor = 0;
    for (const block of sourceTextBlocks(text, extraction, layout)) {
      if (!layout.preformatted.some(region => block.start >= region.start && block.end <= region.end)) continue;
      const body = text.slice(block.start, block.end);
      const delimiter = body.match(/(?:(?:\r\n|\r|\n)[ \t]*)+$/u)?.[0] ?? "";
      parts.push(text.slice(cursor, block.start), body.slice(0, body.length - delimiter.length).replace(/[\r\n]/g, " "), delimiter);
      cursor = block.end;
    }
    parts.push(text.slice(cursor));
    view = parts.join("");
  }
  return segmenter.segment(view);
}
