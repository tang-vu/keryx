import type { Decision } from "../types";

/** Recorded codes/decisions only; never promote discovery metadata into paper evidence. */
export function emptyPublicEvidenceDetail(
  outcomes: Array<{ name: string; code: string }>,
  skipped: Decision[],
): string {
  const detail = outcomes.length
    ? `Selected public originals could not supply usable text: ${outcomes.slice(0, 3).map(outcome => `${outcome.name.slice(0, 120)} (${outcome.code})`).join("; ")}. ` +
      "Inspect the recorded PDF/fallback failures; try one exact versioned arXiv target or a supported original URL. "
    : `No original public document was successfully read. ${skipped.slice(0, 3).map(decision => `${decision.sourceName.slice(0, 120)}: ${decision.rationale.slice(0, 350)}`).join("; ")} ` +
      "Use a narrower question with an exact DOI or versioned arXiv target and inspect the SKIP reasons. ";
  return detail + "A larger source budget does not resolve a free-source attention gate or extraction limit. Metadata previews are not read evidence. This does not establish that no relevant evidence exists.";
}
