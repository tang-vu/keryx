import type { ClaimSufficiency, GatheredContent } from "./reasoning-engine";

export const COVERAGE_GUIDANCE =
  "Assess only the exact scope of each requested research question. First identify the answer " +
  "explicitly supported by the supplied text, then identify any requested part still missing. " +
  "Do not invent extra requirements, demand implementation details not asked for, or lower coverage " +
  "merely because a source is excerpted when its passages directly answer the question. " +
  "Conversely, a title, shared vocabulary, or general warning does not answer an unstated procedure. " +
  "Use 0 for no answer, 0.1-0.3 for topical context without an answer, 0.4-0.6 for a partial answer, " +
  "0.7-0.9 for a direct answer with a small requested gap, and 1 for all requested parts explicitly answered. " +
  "Name only markers that actually provide that answer. Distinguish missing evidence from uncertainty " +
  "about a publisher's reliability; these coverage scores are not independent truth verification. ";

/** Missing/malformed coverage or source links cannot justify stopping a research run. */
export function normalizeCoverage(value: unknown, claims: string[], gathered: GatheredContent[]): ClaimSufficiency[] {
  const rows = Array.isArray(value) ? value : [];
  const markers = new Set(gathered.filter((source) => source.text.trim()).map((source) => source.marker));
  return claims.map((claim, index) => {
    const row = rows[index] && typeof rows[index] === "object" ? rows[index] as Record<string, unknown> : {};
    const coveredBy = Array.isArray(row.coveredBy)
      ? [...new Set(row.coveredBy.filter((marker): marker is string => typeof marker === "string" && markers.has(marker)))] : [];
    const coverage = typeof row.coverage === "number" && Number.isFinite(row.coverage) && coveredBy.length
      ? Math.max(0, Math.min(1, row.coverage)) : 0;
    return { claim, coverage, coveredBy };
  });
}

/** Coverage describes support; stopping also requires an explicit answer and no
 * model-reported requested gap. This is not independent evidence verification. */
export function canStopForCoverage(value: unknown, normalized: ClaimSufficiency[]): boolean {
  if (!Array.isArray(value) || normalized.length === 0 || value.length !== normalized.length) return false;
  return normalized.every((claim, index) => {
    const row = value[index];
    return claim.coverage >= 0.7 && claim.coveredBy.length > 0 && row !== null && typeof row === "object"
      && typeof row.supportedAnswer === "string" && row.supportedAnswer.trim().length > 0
      && Array.isArray(row.missingRequestedParts) && row.missingRequestedParts.length === 0;
  });
}
