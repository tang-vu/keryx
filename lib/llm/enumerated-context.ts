import type { TextRegion } from "../web-research/html-text-layout";

const MAX_SIBLINGS = 8;

function singleLineBody(text: string): string | undefined {
  const body = text.replace(/(?:\r\n|\r|\n)$/u, "").replace(/[ \t]+$/u, "");
  // Ordinary physical lines only. Observed preformatted paragraphs and PDF
  // continuation groups keep their existing source-aware boundary policy.
  if (/[\r\n]/u.test(body)) return;
  return body;
}

export function visibleEnumerationKind(text: string): string | undefined {
  // Visible syntax is a retrieval cue, not restored DOM identity or meaning.
  const body = singleLineBody(text);
  const item = body?.match(/^([ \t]*)(?:(\d+[.)])[ \t]+|([-*•])[ \t]+|([\p{L}\p{N}_][\p{L}\p{N}_./+()-]{0,79})[ \t]*:[ \t]+)\S/u);
  return item ? `${item[1]}:${item[2] ? "number" : item[3] ? item[3] : "label"}` : undefined;
}

function itemKey(text: string, block: TextRegion): string | undefined {
  return visibleEnumerationKind(text.slice(block.start, block.end));
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

/** Complete short visible runs, optionally with one short single-line colon intro.
 * The linear pass rejects every prefix/suffix of an oversized ordinary run.
 * Larger runs still use bounded sibling fallback; neither path proves coverage.
 */
export function enumeratedContext(text: string, blocks: readonly TextRegion[], maximum: number,
  preformatted: readonly TextRegion[] = []): Map<number, TextRegion> {
  const contexts = new Map<number, TextRegion>();
  let preIndex = 0;
  for (let first = 0; first < blocks.length;) {
    const block = blocks[first]!;
    while (preformatted[preIndex] && preformatted[preIndex]!.end <= block.start) preIndex++;
    const pre = preformatted[preIndex];
    const kind = pre && pre.start < block.end ? undefined : itemKey(text, block);
    if (!kind) { first++; continue; }
    const lower = preformatted[preIndex - 1]?.end ?? 0;
    const upper = pre?.start ?? text.length;
    let last = first;
    // Scan the whole ordinary run once before labeling any window a full run.
    // Observed pre regions delimit ordinary runs and cannot supply their intro.
    while (last + 1 < blocks.length) {
      const previous = blocks[last]!, next = blocks[last + 1]!;
      if (next.start !== previous.end || next.end > upper || itemKey(text, next) !== kind) break;
      last++;
    }
    const end = blocks[last]!.end;
    if (last > first && end - block.start <= maximum) {
      let start = block.start;
      const introduction = blocks[first - 1];
      if (introduction && introduction.start >= lower && introduction.end === start &&
          introduction.end - introduction.start <= 120 && end - introduction.start <= maximum) {
        const body = singleLineBody(text.slice(introduction.start, introduction.end));
        if (body && /:[ \t]*$/u.test(body)) start = introduction.start;
      }
      const region = { start, end };
      for (let index = first; index <= last; index++) contexts.set(blocks[index]!.start, region);
    }
    first = last + 1;
  }
  return contexts;
}
