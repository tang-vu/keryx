import type { evidenceContext } from "./evidence-context";
import type { GatheredContent } from "./reasoning-engine";
import { isWellFormedUtf16 } from "./well-formed-utf16";
import { completeEvidenceSpans } from "./evidence-span";
import { sourceSentenceSegments, type SourceExtraction } from "./source-sentences";
import { sourceHtmlLayout, sourceTextBlocks } from "./source-text-blocks";
import type { HtmlTextLayout } from "../web-research/html-text-layout";
import { visibleEnumerationKind } from "./enumerated-context";

export interface ContextualQuoteOption {
  quoteId: string;
  marker: string;
  text: string;
  /** UTF-16 offsets into gathered text; all ends are exclusive. */
  start: number;
  end: number;
  contextStart: number;
  contextEnd: number;
  context: string;
  /** Available gathered text exists outside this context, not a semantic assessment. */
  prefixOmitted: boolean;
  suffixOmitted: boolean;
}

const MAX_SOURCE_CHARACTERS = 200_000;
const MAX_QUOTE_CHARACTERS = 240;
const MAX_CONTEXT_CHARACTERS = 1200;
const MAX_QUOTES = 64;
const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
const highSurrogate = (value: string) => /[\uD800-\uDBFF]/.test(value);
const lowSurrogate = (value: string) => /[\uDC00-\uDFFF]/.test(value);

function invalid(reason: string): never {
  // Do not include source text in a validation error.
  throw new Error(`Invalid quote context: ${reason}`);
}

/** Index of the first boundary at or after an offset. */
function ceiling(boundaries: number[], offset: number): number {
  let low = 0;
  let high = boundaries.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (boundaries[middle] < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function floor(boundaries: number[], offset: number): number {
  const next = ceiling(boundaries, offset);
  return boundaries[next] > offset ? next - 1 : next;
}

function trimSpan(text: string, start: number, end: number): [number, number] {
  // A selected passage or a bounded chunk may end inside a pair. Keep only whole
  // code points, without changing or looking up the quotation elsewhere.
  if (lowSurrogate(text[start] ?? "")) start++;
  if (highSurrogate(text[end - 1] ?? "")) end--;
  const body = text.slice(start, end);
  start += body.length - body.trimStart().length;
  end -= body.length - body.trimEnd().length;
  return [start, Math.max(start, end)];
}

function contextBoundaries(text: string, extraction?: SourceExtraction, layout?: HtmlTextLayout) {
  const lines = [0];
  if (layout) for (const block of sourceTextBlocks(text, extraction, layout)) lines.push(block.start, block.end);
  else if (extraction !== "pdf") for (const match of text.matchAll(/\n/g)) lines.push(match.index + 1);
  if (lines.at(-1) !== text.length) lines.push(text.length);
  lines.sort((a, b) => a - b);
  const sentences = [0];
  for (const sentence of sourceSentenceSegments(text, extraction, layout)) sentences.push(sentence.index + sentence.segment.length);
  // Both indexes are bounded by the already-unlocked 200k prefix. No source is
  // fetched, no gaps are joined, and structural boundaries do not prove completeness.
  const all = [...new Set([...lines, ...sentences])].sort((a, b) => a - b);
  return { lines, sentences, all };
}

function contextSpan(text: string, start: number, end: number, boundaries: ReturnType<typeof contextBoundaries>): [number, number] {
  let baseStart = start;
  let baseEnd = end;
  // Preserve the entire containing short block, otherwise the containing sentence
  // when it fits. Neighboring boundaries then use the remaining contextual space.
  for (const index of [boundaries.lines, boundaries.sentences]) {
    const before = index[floor(index, start)];
    const after = index[ceiling(index, end)];
    if (after - before <= MAX_CONTEXT_CHARACTERS) {
      baseStart = before;
      baseEnd = after;
      break;
    }
  }
  const spare = MAX_CONTEXT_CHARACTERS - (baseEnd - baseStart);
  let windowStart = Math.max(0, baseStart - Math.floor(spare / 2));
  const windowEnd = Math.min(text.length, windowStart + MAX_CONTEXT_CHARACTERS);
  windowStart = Math.max(0, windowEnd - MAX_CONTEXT_CHARACTERS);
  const before = boundaries.all[ceiling(boundaries.all, windowStart)];
  const after = boundaries.all[floor(boundaries.all, windowEnd)];
  let contextStart = before <= baseStart ? before : windowStart;
  let contextEnd = after >= baseEnd ? after : windowEnd;
  if (lowSurrogate(text[contextStart] ?? "")) contextStart++;
  if (highSurrogate(text[contextEnd - 1] ?? "")) contextEnd--;
  return [contextStart, contextEnd];
}

/** A visible enumerated item may hold multiple complete sentences. Offer its
 * whole exact block only when its outer boundaries already satisfy the existing
 * strict span policy. This adds a menu choice, never a new eligibility rule.
 */
function completeShortItems(original: GatheredContent, scanned: string, selected: ReturnType<typeof evidenceContext>[number]["passages"],
  completeSpans: ReturnType<typeof completeEvidenceSpans>, layout: HtmlTextLayout | undefined) {
  if (original.webProvenance?.extraction === "pdf" || original.webProvenance?.truncated || scanned.length !== original.text.length) return [];
  const items: { start: number; end: number; text: string }[] = [];
  let spanIndex = 0;
  let preIndex = 0;
  for (const block of sourceTextBlocks(scanned, original.webProvenance?.extraction, layout)) {
    const [start, end] = trimSpan(scanned, block.start, block.end);
    if (end - start > MAX_QUOTE_CHARACTERS || !visibleEnumerationKind(scanned.slice(start, end)) ||
        !selected.some(passage => passage.start <= start && passage.end >= end)) continue;
    while (layout?.preformatted[preIndex] && layout.preformatted[preIndex]!.end <= start) preIndex++;
    if (layout?.preformatted[preIndex] && layout.preformatted[preIndex]!.start < end) continue;
    while (completeSpans[spanIndex] && completeSpans[spanIndex]!.start < start) spanIndex++;
    let last = spanIndex;
    while (completeSpans[last] && completeSpans[last]!.end <= end) last++;
    if (last - spanIndex < 2 || completeSpans[spanIndex]!.start !== start || completeSpans[last - 1]!.end !== end) continue;
    items.push({ start, end, text: scanned.slice(start, end) });
    if (items.length === MAX_QUOTES) break;
  }
  return items;
}

/**
 * Literal options from actual evidenceContext passages, bound to their gathered
 * source by unique marker, sourceId and exact offsets. Invalid bindings throw;
 * no partial menu is returned. Quote IDs are local to this particular menu.
 * Context may include already-unlocked neighbors outside the generation passages.
 * It is bounded structural context, never a claim of entailment or completeness;
 * unread document truncation and delivery-kind provenance remain separate.
 */
export function buildContextualQuoteOptions(sources: ReturnType<typeof evidenceContext>, gathered: GatheredContent[],
  policy: { completeSentencesOnly?: boolean; includeShortBlocks?: boolean } = {}): ContextualQuoteOption[] {
  const byMarker = new Map<string, GatheredContent>();
  for (const source of gathered) {
    if (!source.marker?.trim() || byMarker.has(source.marker)) invalid("ambiguous gathered marker");
    byMarker.set(source.marker, source);
  }
  const selectedMarkers = new Set<string>();
  // Validate all passages, including those after the menu cap, before producing options.
  const bindings = sources.map(source => {
    if (selectedMarkers.has(source.marker)) invalid("duplicate context marker");
    selectedMarkers.add(source.marker);
    const original = byMarker.get(source.marker);
    if (!original || original.sourceId !== source.sourceId) invalid("source binding mismatch");
    const scanEnd = Math.min(original.text.length, MAX_SOURCE_CHARACTERS);
    if (source.originalCharacters !== original.text.length || source.scannedCharacters !== scanEnd) invalid("source length mismatch");
    for (const passage of source.passages) {
      if (!Number.isSafeInteger(passage.start) || !Number.isSafeInteger(passage.end) ||
          passage.start < 0 || passage.end < passage.start || passage.end > scanEnd) invalid("passage range mismatch");
      if (original.text.slice(passage.start, passage.end) !== passage.text) invalid("passage text mismatch");
    }
    let scanned = original.text.slice(0, scanEnd);
    if (scanEnd < original.text.length && highSurrogate(scanned.at(-1) ?? "")) scanned = scanned.slice(0, -1);
    if (!isWellFormedUtf16(scanned)) invalid("malformed source Unicode");
    return { source, original, scanned };
  });
  return bindings.flatMap(({ source, original, scanned }, sourceIndex) => {
    if (!source.passages.length || !scanned.length) return [];
    const layout = sourceHtmlLayout(original);
    const boundaries = contextBoundaries(scanned, original.webProvenance?.extraction, layout);
    const options: ContextualQuoteOption[] = [];
    const offeredSpans = new Set<string>();
    const completeSpans = policy.completeSentencesOnly ? completeEvidenceSpans(original) : [];
    let passages = policy.completeSentencesOnly
      ? completeSpans.filter(span => source.passages.some(passage => passage.start <= span.start && passage.end >= span.end))
        .map(span => ({ ...span, text: original.text.slice(span.start, span.end) }))
      : source.passages;
    if (policy.completeSentencesOnly && policy.includeShortBlocks === true) {
      // Existing sentence choices and their IDs retain first claim on the menu.
      // Alternatives use spare capacity; compactness cannot evict a late fact.
      passages = [...passages, ...completeShortItems(original, scanned, source.passages, completeSpans, layout)];
    }
    passages: for (const passage of passages) {
      // Strict spans already have shared source boundaries. Resegmenting original
      // PDF line wraps here would turn a complete span back into a sentence tail.
      const sentences = policy.completeSentencesOnly
        ? [{ index: 0, segment: passage.text }] : segmenter.segment(passage.text);
      for (const sentence of sentences) {
        const [bodyStart, bodyEnd] = trimSpan(scanned, passage.start + sentence.index,
          Math.min(scanned.length, passage.start + sentence.index + sentence.segment.length));
        const body = scanned.slice(bodyStart, bodyEnd);
        let offset = 0;
        while (offset < body.length) {
          if (options.length === MAX_QUOTES) break passages;
          let limit = Math.min(body.length, offset + MAX_QUOTE_CHARACTERS);
          if (limit < body.length) {
            const space = body.lastIndexOf(" ", limit);
            if (space >= offset + 8) limit = space;
            else if (highSurrogate(body[limit - 1])) limit--;
          }
          const [start, end] = trimSpan(scanned, bodyStart + offset, bodyStart + limit);
          const key = `${start}:${end}`;
          if (end - start >= 8 && !offeredSpans.has(key)) {
            offeredSpans.add(key);
            const [contextStart, contextEnd] = contextSpan(scanned, start, end, boundaries);
            options.push({
              quoteId: `q${sourceIndex}_${options.length}`, marker: source.marker,
              text: scanned.slice(start, end), start, end,
              contextStart, contextEnd, context: scanned.slice(contextStart, contextEnd),
              prefixOmitted: contextStart > 0, suffixOmitted: contextEnd < original.text.length,
            });
          }
          if (limit === body.length) break;
          // Match the bounded overlapping word chunks used by the quote menu, but
          // retain their location rather than recovering duplicate text with indexOf.
          const next = offset + Math.max(1, Math.floor((limit - offset) / 2));
          const space = body.indexOf(" ", next);
          offset = space >= next && space < limit ? space + 1 : next;
          if (lowSurrogate(body[offset] ?? "")) offset++;
        }
      }
    }
    return options;
  });
}
