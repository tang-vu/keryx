import type { TextRegion } from "../web-research/html-text-layout";

const MAX_SIBLINGS = 8;

function itemKey(text: string, block: TextRegion): string | undefined {
  const body = text.slice(block.start, block.end).replace(/(?:\r\n|\r|\n)$/u, "").replace(/[ \t]+$/u, "");
  // Ordinary physical lines only. Observed preformatted paragraphs and PDF
  // continuation groups keep their existing source-aware boundary policy.
  if (/[\r\n]/u.test(body)) return;
  const item = body.match(/^([ \t]*)(?:([-*•])[ \t]+|(?:\d{1,4}[.)])[ \t]+|(?:[\p{L}\p{N}_][\p{L}\p{N}_./+()-]{0,63})[ \t]*:[ \t]+)\S/u);
  if (!item) return;
  const kind = item[2] ? `bullet:${item[2]}` : /^[ \t]*\d{1,4}[.)][ \t]+/u.test(body) ? "numbered" : "label";
  return `${item[1]}:${kind}`;
}

/** Bounded structural retrieval cue, never proof of a list's meaning or completeness.
 * Adjacent same-format items share one exact substring when they fit. Blank lines,
 * prose, changed indentation/marker kind, oversized siblings and observed pre
 * boundaries stop expansion. Ordered pre regions are barriers, never new authority.
 */
export function enumeratedContextRange(text: string, blocks: readonly TextRegion[], index: number, maxCharacters: number,
  preformatted: readonly TextRegion[] = []): TextRegion | undefined {
  const block = blocks[index];
  if (!block || block.end - block.start > maxCharacters) return;
  // Find the ordinary-text interval around this block once. Observed regions are
  // ordered/nonoverlapping and capped upstream; neighbor scans stay fixed at eight.
  let low = 0, high = preformatted.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (preformatted[middle]!.end <= block.start) low = middle + 1;
    else high = middle;
  }
  const nextPre = preformatted[low];
  if (nextPre && nextPre.start < block.end) return;
  const lower = preformatted[low - 1]?.end ?? 0;
  const upper = nextPre?.start ?? text.length;
  const key = itemKey(text, block);
  if (!key) return;
  let start = block.start, end = block.end;
  let before = index - 1, after = index + 1;
  let siblings = 0;
  let previousOpen = true, nextOpen = true;
  // The fixed sibling ceiling avoids a line-density-dependent neighbor scan.
  // Prefer closest neighbors on both sides instead of consuming a long list prefix.
  while (siblings < MAX_SIBLINGS && (previousOpen || nextOpen)) {
    const previous = blocks[before];
    if (previousOpen && previous && previous.start >= lower && previous.end === start && end - previous.start <= maxCharacters && itemKey(text, previous) === key) {
      start = previous.start;
      before--;
      siblings++;
    } else previousOpen = false;
    if (siblings === MAX_SIBLINGS) break;
    const next = blocks[after];
    if (nextOpen && next && next.end <= upper && next.start === end && next.end - start <= maxCharacters && itemKey(text, next) === key) {
      end = next.end;
      after++;
      siblings++;
    } else nextOpen = false;
  }
  return siblings ? { start, end } : undefined;
}
