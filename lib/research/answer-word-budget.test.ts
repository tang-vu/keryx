import { describe, expect, it } from "vitest";
import { answerPresentation } from "./answer-presentation";
import { answerWordBudget, completeAnswerWords } from "./answer-word-budget";
import rfc from "../../scripts/fixtures/deliverable-rfc-public-20261009.json";

describe("finite ordinary English complete-answer limits", () => {
  it.each(["Keep the note within 180 words.", "Please keep answer at most 180 words.",
    "Answer in no more than 180 words.", "Respond in at most 180 words."])("recognizes %s", question => {
    expect(answerWordBudget(question)).toBe(180);
  });
  it("reproduces the retained full RFC answer's excess without changing the snapshot", () => {
    expect(answerPresentation(rfc.question).requestedMaximumWords).toBe(180);
    expect(completeAnswerWords(rfc.answer)).toBe(296);
  });
  it.each(["RFC 180 contains 180 words.", "Do not keep the note within 180 words.",
    "Do not\nkeep the note within 180 words.", 'Read the title "Keep the note within 180 words."',
    "Keep the note within 180 words, excluding warnings.", "Keep the note within 180.5 words.",
    "Keep the note within 0180 words.", "Keep the note within 0 words.", "Keep the note within 2001 words.",
    "Keep the note within 180 words. Keep the answer within 90 words."])("refuses unsupported/ambiguous %s", question => {
    expect(answerWordBudget(question)).toBeUndefined();
  });
  it("keeps nonordinary, unsupported-language and mixed layout policies unchanged", () => {
    expect(answerPresentation(rfc.question, "retained").requestedMaximumWords).toBeUndefined();
    for (const question of ["Write in Portuguese. Keep the note within 180 words.",
      "Write in German. Keep the note within 180 words.",
      "Antworte auf Deutsch. Keep the note within 180 words.",
      "En français, écrivez une note. Keep the note within 180 words.",
      "Write three short bullets. Keep the note within 180 words."])
      expect(answerPresentation(question).requestedMaximumWords).toBeUndefined();
    expect(completeAnswerWords("  a\tb\nc  ")).toBe(3);
  });
  it("uses positive language eligibility without letting quoted or negated directives override it", () => {
    expect(answerWordBudget("Answer in French. Keep the note within 180 words.")).toBeUndefined();
    expect(answerWordBudget("In French, give a note. Keep the note within 180 words.")).toBeUndefined();
    expect(answerWordBudget("Answer in French. Answer in English. Keep the note within 180 words.")).toBe(180);
    expect(answerWordBudget('Answer in French. Read "Answer in English." Keep the note within 180 words.')).toBeUndefined();
    expect(answerWordBudget("In English, give a note. Do not answer in French. Keep the note within 180 words.")).toBe(180);
    expect(answerWordBudget("In English, give a note. Do not\nanswer in French. Keep the note within 180 words.")).toBe(180);
    expect(answerPresentation('In English, give a note. Read "Answer in French." Keep the note within 180 words.').requestedMaximumWords).toBe(180);
    expect(answerPresentation("In English, give a note. Do not\nanswer in French. Keep the note within 180 words.").requestedMaximumWords).toBe(180);
  });
});
