import type { GatheredContent, Conflict } from "../llm/reasoning-engine";
import type { Confidence } from "../types";
import type { AnswerPresentation } from "../research/answer-presentation";
import { evidenceConfidenceReason } from "../research/confidence-copy";
import { hasKnownSyntheticFingerprint } from "../research/evidence-provenance";
import type { CitedStatement } from "./cited-statements";
import type { EvidenceLedger } from "./evidence-ledger";
import { MIN_REWARD_SUPPORT } from "./evidence-ledger";
import { researchVerdict } from "./research-verdict";

/** Assess only the reviewed sentences actually delivered. Excerpt coverage and
 * hidden citations cannot supply missing sentence support or corroboration.
 * This projection never mutates the reward ledger or authorizes another read. */
export function reviewedSummaryConfidence(input: {
  ledger: EvidenceLedger;
  statements: CitedStatement[];
  sources: GatheredContent[];
  conflicts: Conflict[];
  finalAssessmentSufficient: boolean;
  /** Mirrors the existing final-run synthetic projection, including skipped decisions. */
  hasSyntheticDecision?: boolean;
}, language: AnswerPresentation["language"] = "en"): Confidence {
  const delivered = input.ledger.evidence.filter(item => item.qualifiesForAnswer && input.ledger.acceptedMarkers.has(item.marker));
  const paired = delivered.filter(item => input.statements.some(statement =>
      statement.claimIndex === item.claimIndex && statement.marker === item.marker && statement.quote === item.quote));
  const citedMarkers = [...new Set(paired.map(item => item.marker))];
  if (input.hasSyntheticDecision || input.ledger.evidence.some(item => item.evidenceProvenance === "synthetic-demo" || hasKnownSyntheticFingerprint(item)) ||
      input.sources.some(source => input.ledger.acceptedMarkers.has(source.marker) &&
        (source.evidenceProvenance === "synthetic-demo" || hasKnownSyntheticFingerprint(source)))) {
    return { level: "Low", reason: evidenceConfidenceReason(language, { kind: "synthetic" }) };
  }
  const coverage = (minimum: number) => input.ledger.claimCoverage.map(claim => {
    const supporting = paired.filter(item => item.claimIndex === claim.claimIndex && item.support >= minimum);
    return { ...claim, coverage: Math.min(claim.coverage, Math.max(0, ...supporting.map(item => item.support))),
      coveredBy: [...new Set(supporting.map(item => item.marker))] };
  });
  const assess = (minimum: number) => researchVerdict({ coverage: coverage(minimum), citedMarkers,
    sourceMarkers: input.sources.map(source => source.marker), sources: input.sources,
    conflicts: input.conflicts, finalAssessmentSufficient: input.finalAssessmentSufficient }, language);
  const verdict = assess(MIN_REWARD_SUPPORT);
  // High needs strong paired evidence from both publisher groups on every target,
  // rather than one strong excerpt and a merely relevant second source.
  if (verdict.level === "High" && assess(0.7).level !== "High") return { level: "Moderate",
    reason: evidenceConfidenceReason(language, { kind: "limited-sources", count: citedMarkers.length }) };
  return verdict;
}
