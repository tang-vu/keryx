import { expect, it } from "vitest";
import { finishCombinedAnswerLimits } from "./combined-answer-limits";
import type { BulletCountAnswer } from "./bullet-count-answer";
import { completeAnswerWords } from "../research/answer-word-budget";

const state: BulletCountAnswer = { request: { kind: "recognized", mode: "exact", count: 2 }, presentation: { language: "en" },
  original: "Canonical complete evidence", compact: "- First statement. [S1] Original: “First exact excerpt.”\n- Second statement. [S2] Original: “Second exact excerpt.”",
  fallback: "Unmet bullets. Canonical complete evidence" };
it("accepts only a single final candidate that meets both constraints, including exact boundary", () => {
  const canonical = `Funding observation.\n\n${state.original}\n\nKeep the payment receipt.`, before = JSON.stringify(state);
  const compact = canonical.replace(state.original!, state.compact!), maximum = completeAnswerWords(compact);
  expect(finishCombinedAnswerLimits(canonical, state, maximum)).toEqual({ answer: compact, outcome: "met", bullets: 2, words: maximum });
  expect(JSON.stringify(state)).toBe(before);
  const failed = finishCombinedAnswerLimits(canonical, state, maximum - 1);
  expect(failed.outcome).toBe("unmet");expect(failed.answer.endsWith(canonical)).toBe(true);
  expect(failed.words).toBe(completeAnswerWords(failed.answer));
});
it("retains final numbered notices and refuses fitting the word bound by breaking the bullet bound", () => {
  const canonical = `${state.original}\n\n1. Mandatory follow-up`;
  const failed = finishCombinedAnswerLimits(canonical, state, 180);
  expect(failed.outcome).toBe("unmet");expect(failed.answer.endsWith(canonical)).toBe(true);
});
it("keeps early answers and changed core bindings, with Vietnamese or maximum wording", () => {
  const local: BulletCountAnswer = { ...state, presentation: { language: "vi" }, request: { kind: "recognized", mode: "maximum", count: 3 } };
  const answer = "Chưa có bằng chứng. Giữ biên nhận.";
  const failed = finishCombinedAnswerLimits(answer, local, 180);
  expect(failed.outcome).toBe("unmet");expect(failed.answer).toContain("tối đa 3 gạch đầu dòng và tối đa 180 từ");
  expect(failed.answer.endsWith(answer)).toBe(true);
});
