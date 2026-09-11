import type { ClaimCoverageRecord, Confidence } from "../types";
import type { Conflict } from "../llm/reasoning-engine";
import { MIN_REWARD_SUPPORT } from "./evidence-ledger";

/** Coverage does not resolve a reported contradiction. A model's source preference
 * is also not independent corroboration. This affects presentation, not rewards. */
export function researchVerdict(input: { coverage: ClaimCoverageRecord[]; citedMarkers: string[];
  sourceMarkers: string[]; conflicts: Conflict[] }): Confidence {
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
  if (input.conflicts.length) return { level: "Moderate", reason: "source preferences are explained, but conflicting evidence limits confidence" };
  if (cited.size >= 2 && input.coverage.every(claim => claim.coverage >= 0.7)) {
    return { level: "High", reason: `${cited.size} evidence-verified sources ground every sub-claim` };
  }
  return { level: "Moderate", reason: `${cited.size} evidence-verified source${cited.size === 1 ? "" : "s"} cover every sub-claim, but corroboration or support strength is limited` };
}
