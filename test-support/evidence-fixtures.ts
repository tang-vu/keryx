import type { GatheredContent, ProposedEvidence } from "../lib/llm/reasoning-engine";

/** Test fixture authoring only: the fixture explicitly chooses its first literal occurrence.
 * Never use this to recover a model proposal or historical production source/offset. */
export function fixtureEvidenceSpans(gathered: GatheredContent[], evidence: ProposedEvidence[]): ProposedEvidence[] {
  return evidence.map(item => {
    if (item.quoteSpan !== undefined) return item;
    const source = gathered.find(g => g.marker === item.marker);
    const start = source?.text.indexOf(item.quote) ?? -1;
    return start < 0 ? item : { ...item, quoteSpan: { start, end: start + item.quote.length } };
  });
}
