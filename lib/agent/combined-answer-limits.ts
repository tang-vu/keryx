import { completeAnswerWords } from "../research/answer-word-budget";
import { finishBulletCountAnswer, type BulletCountAnswer } from "./bullet-count-answer";

/** Both predicates see the same final answer, including all operational notices.
 * A failed candidate never replaces canonical content or weakens either limit. */
export function finishCombinedAnswerLimits(canonical: string, state: BulletCountAnswer, maximumWords: number): {
  answer: string; outcome: "met" | "unmet"; words: number; bullets: number;
} {
  const candidate = finishBulletCountAnswer(canonical, state);
  if (candidate.outcome === "met" && completeAnswerWords(candidate.answer) <= maximumWords)
    return { ...candidate, words: completeAnswerWords(candidate.answer) };
  const count = state.request.count, maximum = state.request.mode === "maximum";
  const notice = state.presentation.language === "vi"
    ? `Chưa thể đáp ứng đồng thời ${maximum ? "tối đa" : "đúng"} ${count} gạch đầu dòng và tối đa ${maximumWords} từ mà vẫn giữ mọi nhận định, trích đoạn, chỗ thiếu bằng chứng và thông báo; nội dung đầy đủ ở dưới.`
    : `Could not meet both ${maximum ? "at most" : "exactly"} ${count} bullets and at most ${maximumWords} words while retaining all statements, excerpts, evidence gaps and notices; full content follows.`;
  const answer = `${notice}\n\n${canonical}`;
  return { answer, outcome: "unmet", words: completeAnswerWords(answer),
    bullets: [...answer.matchAll(/^[\t ]*(?:[-+*•]|\d+[.)])\s+/gmu)].length };
}
