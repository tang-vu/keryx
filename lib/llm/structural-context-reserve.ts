import { MAX_RESEARCH_TARGETS } from "./research-target-limits";

type Range = { start: number; end: number };
type Passage = Range & { text: string };

// Ordering only: never serialize this metadata or use it as evidence authority.
// Keep the original menu's choices ahead of newly appended structural context.
const baselines = new WeakMap<Passage[], { text: string; ranges: readonly Range[] }>();

export function observeStructuralReserve(text: string, passages: Passage[], baseline: readonly Range[]) {
  if (!baseline.length || baseline.length > MAX_RESEARCH_TARGETS + 1) return;
  baselines.set(passages, { text, ranges: baseline.map(({ start, end }) => ({ start, end })) });
}

export function structuralReserveBaseline(text: string, passages: Passage[]): Passage[] | undefined {
  const baseline = baselines.get(passages);
  if (!baseline || baseline.text !== text || !baseline.ranges.every(range =>
    Number.isSafeInteger(range.start) && Number.isSafeInteger(range.end) &&
    range.start >= 0 && range.end > range.start && range.end <= text.length &&
    passages.some(passage => passage.start <= range.start && passage.end >= range.end))) return;
  // A mutated/copied selection cannot restore removed spans from this ordering hint.
  return baseline.ranges.map(range => ({ ...range, text: text.slice(range.start, range.end) }));
}
