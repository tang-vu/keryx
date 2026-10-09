import type { Confidence } from "../types";
import { confidenceBanner } from "../research/confidence-copy";
import { completeAnswerWords } from "../research/answer-word-budget";
import type { CitedStatement } from "./cited-statements";
import { MIN_REWARD_SUPPORT, type EvidenceLedger } from "./evidence-ledger";

function literal(value: string): string {
  return value.replace(/\[(S\d+)\]/g, "[\u200b$1]").replace(/[`*_]/g, "$&\u200b").replace(/[\r\n]+/g, " ");
}

/** Renderer projection only. Never feeds attribution, evidence gates or payments. */
export function compactWordBudgetAnswer(ledger: EvidenceLedger, statements: CitedStatement[], confidence: Confidence): string | undefined {
  const qualifying = ledger.evidence.filter(item => (item.qualifiesForAnswer ?? item.qualifiesForReward) && ledger.acceptedMarkers.has(item.marker));
  const summary = statements.filter(statement => qualifying.some(item => item.claimIndex === statement.claimIndex &&
    item.marker === statement.marker && item.quote === statement.quote));
  if (!summary.length || confidence.level !== "Low" || !ledger.claimCoverage.length) return undefined;
  const sections = ledger.claimCoverage.map(claim => {
    const quotes = qualifying.filter(item => item.claimIndex === claim.claimIndex);
    const sentences = summary.filter(statement => statement.claimIndex === claim.claimIndex);
    const paired = sentences.map(statement => `${literal(statement.text)} [${statement.marker}] Source text: “${literal(statement.quote)}”`);
    const rest = quotes.filter(item => !sentences.some(statement => statement.marker === item.marker && statement.quote === item.quote));
    const gap = !quotes.length || !sentences.length || !(claim.coverage >= MIN_REWARD_SUPPORT);
    return [...(gap ? [`Requested topic (unverified): “${literal(claim.claim)}”`] : []), ...paired,
      ...rest.map(item => `“${literal(item.quote)}” [${item.marker}]`),
      ...(!quotes.length ? ["Evidence gap: no qualifying excerpt for this research target."] : []),
      ...(quotes.length && !(claim.coverage >= MIN_REWARD_SUPPORT)
        ? ["Evidence gap: the recorded assessment remains below the support threshold for this target."] : []),
    ].join("\n\n");
  });
  // Keep full confidence rationale once, instead of repeating its limitations in three places.
  return confidenceBanner([...sections,
    "Model-written summaries. Grounding proves neither truth nor entailment. Sources may conflict; payment states remain in receipts.",
  ].join("\n\n"), confidence, "en");
}

/** Final selection occurs after ALL operational notices and money decisions. */
export function finishWordBudgetAnswer(fullAnswer: string, compactAnswer: string | undefined, maximumWords: number): {
  answer: string; outcome: "unchanged" | "compact" | "unmet"; words: number;
} {
  if (completeAnswerWords(fullAnswer) <= maximumWords) return { answer: fullAnswer, outcome: "unchanged", words: completeAnswerWords(fullAnswer) };
  if (compactAnswer !== undefined && completeAnswerWords(compactAnswer) <= maximumWords)
    return { answer: compactAnswer, outcome: "compact", words: completeAnswerWords(compactAnswer) };
  const answer = `Could not meet the ${maximumWords}-word limit while retaining all admitted statements, excerpts, evidence gaps and operational notices; full content follows.\n\n${fullAnswer}`;
  return { answer, outcome: "unmet", words: completeAnswerWords(answer) };
}
