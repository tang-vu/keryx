import type { GatheredContent } from "./reasoning-engine";
import { isWellFormedUtf16 } from "./well-formed-utf16";
import { sourceSentenceSegments } from "./source-sentences";

export interface EvidenceSpan { start: number; end: number }
const MAX_SOURCE_CHARACTERS = 200_000;

/** Complete structural sentence spans, not a claim of semantic independence. */
export function completeEvidenceSpans(source: GatheredContent): EvidenceSpan[] {
  let scanned = source.text.slice(0, MAX_SOURCE_CHARACTERS);
  const last = scanned.charCodeAt(scanned.length - 1);
  const next = source.text.charCodeAt(scanned.length);
  // A valid pair cut by our scan bound is not malformed source text. Keep earlier
  // exact offsets while withholding that incomplete tail; do not repair real orphans.
  if (scanned.length < source.text.length && last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
    scanned = scanned.slice(0, -1);
  }
  if (!isWellFormedUtf16(scanned)) return [];
  const cutEnd = scanned.length < source.text.length || source.webProvenance?.truncated === true;
  const spans: EvidenceSpan[] = [];
  for (const sentence of sourceSentenceSegments(scanned, source.webProvenance?.extraction)) {
    const body = scanned.slice(sentence.index, sentence.index + sentence.segment.length);
    const start = sentence.index + body.length - body.trimStart().length;
    const end = sentence.index + body.trimEnd().length;
    if (end - start < 8 || end - start > 240) continue;
    // Segmenter treats an unfinished final fragment as a sentence. Require an
    // observed terminator and never call a truncated extraction/scan edge complete.
    if (!/[.!?。！？]["'”’»\])}]*$/u.test(scanned.slice(start, end))) continue;
    if (cutEnd && sentence.index + body.length === scanned.length) continue;
    spans.push({ start, end });
  }
  return spans;
}

/** Exact source binding; missing metadata must not be repaired by text lookup. */
export function isCompleteEvidenceSpan(source: GatheredContent, quote: string, span: EvidenceSpan | undefined): boolean {
  if (!span || !Number.isSafeInteger(span.start) || !Number.isSafeInteger(span.end) ||
      span.start < 0 || span.end <= span.start || span.end > Math.min(source.text.length, MAX_SOURCE_CHARACTERS) ||
      quote.length < 8 || quote.length > 240 || source.text.slice(span.start, span.end) !== quote) return false;
  const boundaries = completeEvidenceSpans(source);
  return boundaries.some(candidate => candidate.start === span.start) && boundaries.some(candidate => candidate.end === span.end);
}
