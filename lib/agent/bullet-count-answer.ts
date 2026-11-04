import type { AnswerPresentation } from "../research/answer-presentation";
import type { ExplicitBulletCount } from "../research/explicit-bullet-count";
import type { Confidence } from "../types";
import { confidenceBanner } from "../research/confidence-copy";
import { bulletCountNotice, compactGroundedAnswer, finalizeGroundedAnswer } from "./answer-grounding";

export interface BulletCountAnswer {
  request: Extract<ExplicitBulletCount, { kind: "recognized" }>;
  presentation: AnswerPresentation;
  original?: string;
  compact?: string;
  fallback?: string;
}

/** Prepare presentation candidates only. The original answer remains the
 * factual attribution/settlement input; no model call or evidence mutation. */
export function prepareBulletCountAnswer(state: BulletCountAnswer,
  input: Parameters<typeof finalizeGroundedAnswer>[0], original: string, confidence?: Confidence): BulletCountAnswer {
  const presentation = { ...state.presentation, requestedBulletCount: state.request.count };
  const maximum = state.request.mode === "maximum";
  const compact = compactGroundedAnswer({ ...input, presentation }, maximum);
  const full = finalizeGroundedAnswer({ ...input, presentation: { ...presentation, requestedBulletCount: undefined } });
  const fallback = `${bulletCountNotice(presentation, maximum)}\n\n${full}`;
  const banner = (body: string) => confidence ? confidenceBanner(body, confidence, presentation.language) : body;
  return { ...state, original, ...(compact ? { compact: banner(compact) } : {}), fallback: banner(fallback) };
}

function bullets(answer: string): number {
  return [...answer.matchAll(/^[\t ]*(?:[-+*•]|\d+[.)])\s+/gmu)].length;
}

/** Apply only after all canonical notices and payment effects. Count every
 * final list row, including mandatory follow-ups; never remove one to fit. */
export function finishBulletCountAnswer(canonical: string, state: BulletCountAnswer): {
  answer: string; outcome: "met" | "unmet"; bullets: number;
} {
  if (state.original && canonical.includes(state.original)) {
    if (state.compact) {
      const answer = canonical.replace(state.original, () => state.compact!), count = bullets(answer);
      if (count > 0 && (state.request.mode === "maximum" ? count <= state.request.count : count === state.request.count))
        return { answer, outcome: "met", bullets: count };
    }
    if (state.fallback) {
      const answer = canonical.replace(state.original, () => state.fallback!);
      return { answer, outcome: "unmet", bullets: bullets(answer) };
    }
  }
  // Early/no-source result or an intervening projection: preserve its exact
  // content and notices rather than pretending its core binding survived.
  const notice = bulletCountNotice({ ...state.presentation, requestedBulletCount: state.request.count }, state.request.mode === "maximum");
  const answer = `${notice}\n\n${canonical}`;
  return { answer, outcome: "unmet", bullets: bullets(answer) };
}
