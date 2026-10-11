import type { Confidence } from "../types";
import { confidenceBanner } from "../research/confidence-copy";
import type { CitedStatement } from "./cited-statements";
import { MIN_REWARD_SUPPORT, type EvidenceLedger } from "./evidence-ledger";
import { spanishAnswer } from "./answer-grounding";

/** Includes ALL visible text, quotations and notices; segmentation is not semantic verification. */
export function completeAnswerSentenceSegments(answer: string): number {
  return [...new Intl.Segmenter("es", { granularity: "sentence" }).segment(answer)]
    .filter(segment => segment.segment.trim().length > 0).length;
}

/** Post-attribution renderer only: never shorten, merge or translate an admitted statement. */
export function compactSentenceNoteAnswer(ledger: EvidenceLedger, statements: CitedStatement[], confidence: Confidence): string | undefined {
  const qualifying = ledger.evidence.filter(item => (item.qualifiesForAnswer ?? item.qualifiesForReward) && ledger.acceptedMarkers.has(item.marker));
  const bound = (statement: CitedStatement, item: EvidenceLedger["evidence"][number]) =>
    statement.claimIndex === item.claimIndex && statement.marker === item.marker && statement.quote === item.quote;
  // Removing repeated target scaffolding is safe only with complete, already admitted pairs.
  // Otherwise the original renderer must retain its targets, partial assessments and gaps.
  if (!statements.length || !ledger.claimCoverage.length || confidence.level !== "Low" ||
      ledger.claimCoverage.some(claim => !(claim.coverage >= MIN_REWARD_SUPPORT) || !statements.some(row => row.claimIndex === claim.claimIndex)) ||
      statements.some(row => !ledger.claimCoverage.some(claim => claim.claimIndex === row.claimIndex) || !qualifying.some(item => bound(row, item))) ||
      qualifying.some(item => !statements.some(row => bound(row, item))) ||
      [...ledger.acceptedMarkers].some(marker => !statements.some(row => row.marker === marker))) return undefined;
  return confidenceBanner(spanishAnswer(ledger, qualifying, statements, false, "pairs"), confidence, "es");
}

/** Apply only after all operational notices; a useful compact note may still fail the EXACT count. */
export function finishSentenceNoteAnswer(fullAnswer: string, compactAnswer: string | undefined, requestedCount: number): {
  answer: string; outcome: "unchanged" | "compact" | "compact-unmet" | "unmet"; sentenceSegments: number;
} {
  const fullCount = completeAnswerSentenceSegments(fullAnswer);
  if (fullCount === requestedCount) return { answer: fullAnswer, outcome: "unchanged", sentenceSegments: fullCount };
  const compactCount = compactAnswer === undefined ? undefined : completeAnswerSentenceSegments(compactAnswer);
  if (compactAnswer !== undefined && compactCount === requestedCount)
    return { answer: compactAnswer, outcome: "compact", sentenceSegments: compactCount };
  const body = compactAnswer ?? fullAnswer;
  const answer = `No fue posible presentar la respuesta completa en ${requestedCount} frases, incluidos los fragmentos citados, la confianza y los avisos operativos, sin eliminar ni inventar contenido; se conserva el contenido completo.\n\n${body}`;
  return { answer, outcome: compactAnswer === undefined ? "unmet" : "compact-unmet", sentenceSegments: completeAnswerSentenceSegments(answer) };
}
