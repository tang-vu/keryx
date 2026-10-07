import { evidenceContext } from "../llm/evidence-context";
import type { SufficiencyInput } from "../llm/reasoning-engine";

/** Exact frozen selected bodies for this private original-completion path. The
 * supplier's full wire-prompt bound still applies; there is no excerpt fallback. */
export function originalFulfillmentContext(input: SufficiencyInput): ReturnType<typeof evidenceContext> {
  return evidenceContext(input.question, input.subClaims, input.gathered).map((source, index) => {
    const { candidateSelection: _selection, contextOmissions: _omissions, ...metadata } = source;
    const text = input.gathered[index].text;
    return { ...metadata, originalCharacters: text.length, scannedCharacters: text.length, excerpted: false,
      passages: text ? [{ start: 0, end: text.length, text }] : [] };
  });
}
