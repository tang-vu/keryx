import { describe, expect, it } from "vitest";
import { answerPresentation, presentationStatementGuidance } from "./answer-presentation";
import { nativeAnswerInstructions } from "./native-answer-intent";
import { isPresentationLanguage, presentationLanguage, systemPresentationLanguage } from "../../shared/i18n/presentation-language";

const positive = [
  "Answer in Arabic.", "Please reply using Arabic.", "أجب بالعربية.", "أجب باللغة العربية.",
  "من فضلك أجب بالعربية.", "اكتب بالعربية.", "رد باللغة العربية.", "أجب بالعربية.",
];

describe("Arabic explicit ordinary answer intent", () => {
  it.each(positive)("honors the finite original directive %s", instruction => {
    const question = instruction + " Explain the exact original <literal> {count}.";
    expect(answerPresentation(question)).toEqual({ language: "ar", requestedLanguage: "ar" });
    expect(presentationStatementGuidance(answerPresentation(question))).toContain("write each statement in Modern Standard Arabic");
    expect(question).toBe(instruction + " Explain the exact original <literal> {count}.");
  });

  it.each([
    "لا تكتب بالعربية.", "لا تجب بالعربية.", "لا ترد باللغة العربية.", "لا\nاكتب بالعربية.",
    "لن\nأجب بالعربية.", "Do not\nanswer in Arabic.", "Never reply using Arabic.",
    "اشرح عنوان الصفحة «أجب بالعربية.»", "Discuss the page titled Answer in Arabic.",
    "عنوان المصدر: أجب بالعربية.", "Source title: Answer in Arabic.", "`أجب بالعربية.`",
    "Read https://original.test/Answer-in-Arabic.", "Answer in Arabic-derived prose.", "Answer in Arabic2026.",
    "هذا مقتطف عربي أصلي، وليس طلبًا لتغيير لغة الإجابة.", "این یک متن فارسی از منبع است.", "یہ ماخذ کا اردو متن ہے۔",
  ])("keeps negations, titles, quotes, URLs and unrequested scripts inert: %s", question => {
    expect(answerPresentation(question).requestedLanguage).toBeUndefined();
    expect(nativeAnswerInstructions(question.normalize("NFC")).filter(row => row.eligible)).toEqual([]);
  });

  it.each(["أجب بالإنجليزية.", "اكتب باللغة الإنجليزية.", "Answer in English."])(
    "honors a later finite English directive %s", english => {
      expect(answerPresentation(`أجب بالعربية. ${english}`)).toEqual({ language: "en", requestedLanguage: "en" });
    });
  it.each(["؟", "؛"])("honors the Arabic clause boundary %s", separator => {
    expect(answerPresentation(`ما الذي تقوله المصادر${separator} أجب بالعربية.`)).toEqual({ language: "ar", requestedLanguage: "ar" });
  });
  it("keeps last eligible precedence and treats quoted later commands as original data", () => {
    expect(answerPresentation("Answer in English. أجب بالعربية.")).toEqual({ language: "ar", requestedLanguage: "ar" });
    expect(answerPresentation('أجب بالعربية. Explain "Answer in English."')).toEqual({ language: "ar", requestedLanguage: "ar" });
    expect(answerPresentation("أجب بالعربية. لا\nأجب بالإنجليزية.")).toEqual({ language: "ar", requestedLanguage: "ar" });
  });
  it.each(["retained", "legacy"] as const)("preserves the %s original directive grammar", scope => {
    for (const instruction of positive) expect(answerPresentation(instruction, scope).requestedLanguage).toBeUndefined();
  });
  it("keeps an Arabic request distinct from an English word budget and from original bytes", () => {
    const question = "أجب بالعربية. Answer in at most 40 words. Original <source> {count}.";
    expect(answerPresentation(question)).toEqual({ language: "ar", requestedLanguage: "ar" });
    expect(answerPresentation("Answer in Arabic. Give 2 short bullets.").requestedBulletCount).toBe(2);
  });
});

it("separates exact Arabic observations from system labels and neighboring scripts", () => {
  expect(presentationLanguage("ar")).toBe("ar");
  expect(isPresentationLanguage("ar")).toBe(true);
  for (const alias of ["ar-SA", "ar_SA", "Arabic", "AR", "ar-Arab", "fa", "ur", "constructor", "__proto__"]) {
    expect(presentationLanguage(alias)).toBeUndefined();
    expect(isPresentationLanguage(alias)).toBe(false);
  }
  expect(systemPresentationLanguage("ar-SA")).toBe("ar");
  expect(systemPresentationLanguage("fa-IR")).toBeUndefined();
  expect(systemPresentationLanguage("ur-PK")).toBeUndefined();
});
