import type { GatheredContent } from "./reasoning-engine";
import { observedHtmlTextLayout, type HtmlTextLayout, type TextRegion } from "../web-research/html-text-layout";
import type { SourceExtraction } from "./source-sentences";

export function sourceHtmlLayout(source: GatheredContent): HtmlTextLayout | undefined {
  const layout = source.webProvenance?.extraction === "html" && source.sourceKind === "public-reference"
    ? observedHtmlTextLayout(source.text, source.htmlTextLayout) : undefined;
  return layout && source.contentVersion === layout.textSha256 ? layout : undefined;
}

/** Ordinary lines retain their historical boundaries. Only observed pre regions
 * group physical wraps, with blank lines separating contiguous paragraphs.
 */
export function sourceTextBlocks(text: string, extraction?: SourceExtraction, layout?: HtmlTextLayout): TextRegion[] {
  if (extraction === "pdf") return [{ start: 0, end: text.length }];
  const blocks: TextRegion[] = [];
  const lines = (start: number, end: number) => {
    for (const match of text.slice(start, end).matchAll(/[^\n]+(?:\n|$)/g)) blocks.push({ start: start + match.index, end: start + match.index + match[0].length });
  };
  let cursor = 0;
  for (const region of extraction === "html" ? layout?.preformatted ?? [] : []) {
    if (region.start >= text.length) break;
    lines(cursor, region.start);
    const end = Math.min(region.end, text.length);
    const groups: TextRegion[] = [];
    let start = region.start;
    for (const blank of text.slice(start, end).matchAll(/(?:\r\n|\r(?!\n)|\n)[ \t]*(?:\r\n|\r(?!\n)|\n)+/g)) {
      const next = region.start + blank.index + blank[0].length;
      groups.push({ start, end: next });
      start = next;
    }
    if (start < end) groups.push({ start, end });
    const grouped: TextRegion[] = [];
    for (const group of groups) {
      const previous = grouped.at(-1);
      const numbered = previous && text.slice(previous.start, previous.end).match(/^([ \t]*)\d+\.[ \t]+\S/u);
      const indent = text.slice(group.start, group.end).match(/^([ \t]*)\S/u)?.[1].length;
      // A deeper indented example stays with its numbered preformatted item.
      // This recognizes visible layout only, never the rule's meaning or truth.
      if (previous && numbered && indent !== undefined && indent > numbered[1]!.length) previous.end = group.end;
      else grouped.push({ ...group });
    }
    blocks.push(...grouped);
    cursor = end;
  }
  lines(cursor, text.length);
  return blocks;
}
