import type { TextRegion } from "../web-research/html-text-layout";

export function visibleEnumerationKind(text: string): string | undefined {
  // Visible enumeration syntax only: this does not reconstruct lost DOM list
  // identity or interpret which item is a rule, default, exception or example.
  const item = text.match(/^([ \t]*)(?:(\d+[.)])[ \t]+|([-*•])[ \t]+|([\p{L}\p{N}_][\p{L}\p{N}_./+-]{0,79}):[ \t]+)\S/u);
  return item ? `${item[1]!.length}:${item[2] ? "number" : item[3] ? item[3] : "label"}` : undefined;
}

/** Short, contiguous visible sibling runs share one retrieval window. Larger
 * runs retain the selector's ordinary bounded nomination behavior. This mapping
 * never changes source-block/quote eligibility or promotes semantic support.
 */
export function enumeratedContext(text: string, blocks: readonly TextRegion[], maximum: number, preformatted: readonly TextRegion[] = []): Map<number, TextRegion> {
  const contexts = new Map<number, TextRegion>();
  let preIndex = 0;
  for (let first = 0; first < blocks.length;) {
    const block = blocks[first]!;
    while (preformatted[preIndex] && preformatted[preIndex]!.end <= block.start) preIndex++;
    const pre = preformatted[preIndex];
    const kind = pre && pre.start < block.end ? undefined : visibleEnumerationKind(text.slice(block.start, block.end));
    if (!kind) { first++; continue; }
    let last = first;
    while (last + 1 < blocks.length) {
      const previous = blocks[last]!, next = blocks[last + 1]!;
      if (next.start !== previous.end || next.end - block.start > maximum ||
          pre && pre.start < next.end || visibleEnumerationKind(text.slice(next.start, next.end)) !== kind) break;
      last++;
    }
    // Do not turn the beginning of a longer list into an apparently complete
    // short run. No sibling bundle may bridge an omitted item or blank line.
    const next = blocks[last + 1];
    const continued = next && next.start === blocks[last]!.end && visibleEnumerationKind(text.slice(next.start, next.end)) === kind;
    if (last > first && !continued) {
      let start = block.start;
      const introduction = blocks[first - 1];
      if (introduction && introduction.end === start && introduction.end - introduction.start <= 120 &&
          /:[ \t\r\n]*$/u.test(text.slice(introduction.start, introduction.end)) &&
          blocks[last]!.end - introduction.start <= maximum) start = introduction.start;
      const region = { start, end: blocks[last]!.end };
      for (let index = first; index <= last; index++) contexts.set(blocks[index]!.start, region);
    }
    // A long run is skipped as a whole, with linear work independent of item
    // density. Its individual anchors still use the original selector path.
    first = last + 1;
    while (continued && first < blocks.length && blocks[first]!.start === blocks[first - 1]!.end &&
        visibleEnumerationKind(text.slice(blocks[first]!.start, blocks[first]!.end)) === kind) first++;
  }
  return contexts;
}
