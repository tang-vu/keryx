import type { ClaimCoverageRecord, Confidence } from "../types";
import type { Conflict } from "../llm/reasoning-engine";
import { MIN_REWARD_SUPPORT } from "./evidence-ledger";
import type { GatheredContent } from "../llm";
import { bodyIdentity } from "../web-research/url-identity";
import { scholarlyWorkGroups } from "../scholarly/work-groups";
import type { AnswerPresentation } from "../research/answer-presentation";
import { evidenceConfidenceReason } from "../research/confidence-copy";

/** Coverage does not resolve a contradiction or override an incomplete final
 * assessment. Source preference is not independent corroboration. Presentation only. */
export function researchVerdict(input: { coverage: ClaimCoverageRecord[]; citedMarkers: string[];
  sourceMarkers: string[]; sources?: GatheredContent[]; conflicts: Conflict[]; finalAssessmentSufficient: boolean },
  language: AnswerPresentation["language"] = "en"): Confidence {
  const cited = new Set(input.citedMarkers), known = new Set(input.sourceMarkers);
  if (!cited.size) return { level: "Low", reason: evidenceConfidenceReason(language, { kind: "no-citation" }) };
  const unresolved = input.conflicts.filter(conflict => {
    const positions = new Set(conflict.positions.map(position => position.marker));
    return positions.size < 2 || !positions.has(conflict.trusted) || !cited.has(conflict.trusted)
      || [...positions].some(marker => !known.has(marker)) || !conflict.reason.trim();
  }).length;
  if (unresolved) return { level: "Low", reason: evidenceConfidenceReason(language, { kind: "unresolved-conflict", count: unresolved }) };
  const gaps = input.coverage.filter(claim => !(claim.coverage >= MIN_REWARD_SUPPORT)).length;
  if (!input.coverage.length) return { level: "Low", reason: evidenceConfidenceReason(language, { kind: "no-coverage" }) };
  if (gaps) return { level: "Low", reason: evidenceConfidenceReason(language, { kind: "gaps", count: gaps }) };
  if (input.finalAssessmentSufficient !== true) return { level: "Low",
    reason: evidenceConfidenceReason(language, { kind: "incomplete" }) };
  if (input.conflicts.length) return { level: "Moderate", reason: evidenceConfidenceReason(language, { kind: "explained-conflict" }) };
  const groups = new Set<string>(), bodies = new Set<string>(), groupByMarker = new Map<string, string>();
  const workGroups = scholarlyWorkGroups(input.sources ?? [], cited);
  for (const source of input.sources ?? []) {
    if (!cited.has(source.marker)) continue;
    const body = bodyIdentity(source.text), group = workGroups.get(source.marker) ?? "";
    if (!group || bodies.has(body)) continue;
    bodies.add(body); groups.add(group);
    groupByMarker.set(source.marker, group);
  }
  if (input.coverage.every(claim => claim.coverage >= 0.7 &&
    new Set(claim.coveredBy.map(marker => groupByMarker.get(marker)).filter(Boolean)).size >= 2)) {
    return { level: "High", reason: evidenceConfidenceReason(language, { kind: "publisher-groups", count: groups.size }) };
  }
  return { level: "Moderate", reason: evidenceConfidenceReason(language, { kind: "limited-sources", count: cited.size }) };
}
