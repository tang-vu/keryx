import type { ClaimCoverageRecord, Confidence } from "../types";
import type { Conflict } from "../llm/reasoning-engine";
import { MIN_REWARD_SUPPORT } from "./evidence-ledger";
import type { GatheredContent } from "../llm";
import { bodyIdentity, publisherGroup } from "../web-research/url-identity";

/** Coverage does not resolve a contradiction or override an incomplete final
 * assessment. Source preference is not independent corroboration. Presentation only. */
export function researchVerdict(input: { coverage: ClaimCoverageRecord[]; citedMarkers: string[];
  sourceMarkers: string[]; sources?: GatheredContent[]; conflicts: Conflict[]; finalAssessmentSufficient: boolean }): Confidence {
  const cited = new Set(input.citedMarkers), known = new Set(input.sourceMarkers);
  if (!cited.size) return { level: "Low", reason: "no citation passed the evidence gate" };
  const unresolved = input.conflicts.filter(conflict => {
    const positions = new Set(conflict.positions.map(position => position.marker));
    return positions.size < 2 || !positions.has(conflict.trusted) || !cited.has(conflict.trusted)
      || [...positions].some(marker => !known.has(marker)) || !conflict.reason.trim();
  }).length;
  if (unresolved) return { level: "Low", reason: `${unresolved} source disagreement${unresolved === 1 ? " remains" : "s remain"} unresolved; coverage scores do not resolve conflicting evidence` };
  const gaps = input.coverage.filter(claim => !(claim.coverage >= MIN_REWARD_SUPPORT)).length;
  if (!input.coverage.length) return { level: "Low", reason: "no sub-claim coverage is available" };
  if (gaps) return { level: "Low", reason: `${gaps} sub-claim${gaps === 1 ? " remains" : "s remain"} below the evidence threshold` };
  if (input.finalAssessmentSufficient !== true) return { level: "Low",
    reason: "the final assessment does not establish a complete supported answer for every requested part" };
  if (input.conflicts.length) return { level: "Moderate", reason: "source preferences are explained, but conflicting evidence limits confidence" };
  const groups = new Set<string>(), bodies = new Set<string>(), groupByMarker = new Map<string, string>();
  for (const source of input.sources ?? []) {
    if (!cited.has(source.marker)) continue;
    const body = bodyIdentity(source.text), group = source.itemUrl ? publisherGroup(source.itemUrl) : "";
    if (!group || bodies.has(body)) continue;
    bodies.add(body); groups.add(group);
    groupByMarker.set(source.marker, group);
  }
  if (input.coverage.every(claim => claim.coverage >= 0.7 &&
    new Set(claim.coveredBy.map(marker => groupByMarker.get(marker)).filter(Boolean)).size >= 2)) {
    return { level: "High", reason: `${groups.size} publisher domain groups ground every sub-claim with matching evidence spans; grouping does not prove independent corroboration or factual truth` };
  }
  return { level: "Moderate", reason: `${cited.size} evidence-verified source${cited.size === 1 ? "" : "s"} cover every sub-claim, but corroboration or support strength is limited` };
}
