import { describe, expect, it } from "vitest";
import { answerPresentation, presentationStatementGuidance } from "./answer-presentation";
import { nativeAnswerInstructions } from "./native-answer-intent";
import { isPresentationLanguage, presentationLanguage, systemPresentationLanguage } from "../../shared/i18n/presentation-language";

const positive = [
  "Answer in Russian.", "Please reply using Russian.", "Now please write in Russian.",
  "Ответь по-русски.", "Ответьте по-русски.", "Отвечай на русском.",
  "Напиши на русском языке.", "Пиши по-русски.", "Пожалуйста, ответьте на русском языке.",
];

describe("Russian explicit ordinary answer intent", () => {
  it.each(positive)("honors the finite original directive %s", instruction => {
    const question = instruction + " Explain the exact original <literal> {count}.";
    expect(answerPresentation(question)).toEqual({ language: "ru", requestedLanguage: "ru" });
    expect(presentationStatementGuidance(answerPresentation(question))).toContain("write each statement in Russian");
    expect(question).toBe(instruction + " Explain the exact original <literal> {count}.");
  });

  it.each([
    'Discuss the page "Answer in Russian."', "Explain «Ответьте по-русски.»", "`Напиши на русском языке.`",
    "Do not answer in Russian.", "Never reply using Russian.", "Не отвечай по-русски.",
    "Не надо\nОтветь по-русски.", "Никогда не\nпиши по-русски.", "Do not\nanswer in Russian.",
    "Explain the source titled Answer in Russian.", "Прочитай документ о русском языке.",
    "Read the Ukrainian source: Це початковий текст джерела.", "Answer in Russian-like prose.",
    "Answer in Russian_derived.", "Answer in Russian2026.", "Use the URL https://original.test/Answer-in-Russian.",
  ])("keeps negations, titles, quotes, other Cyrillic prose and partial names inert: %s", question => {
    expect(answerPresentation(question).requestedLanguage).toBeUndefined();
    expect(nativeAnswerInstructions(question.normalize("NFC")).filter(row => row.eligible)).toEqual([]);
  });

  it.each(["Ответь по-английски.", "Ответьте на английском языке.", "Пиши на английском."])(
    "honors a later finite English directive %s", english => {
      expect(answerPresentation(`Ответь по-русски. ${english}`)).toEqual({ language: "en", requestedLanguage: "en" });
    });
  it("keeps last eligible directive precedence and ignores a quoted later instruction", () => {
    expect(answerPresentation("Answer in English. Ответь по-русски.")).toEqual({ language: "ru", requestedLanguage: "ru" });
    expect(answerPresentation('Ответь по-русски. Explain "Answer in English."')).toEqual({ language: "ru", requestedLanguage: "ru" });
  });
  it("recognizes whole Russian negation words without treating an ordinary word ending as a negation", () => {
    expect(answerPresentation("О документе и его длине\nОтветь по-русски.")).toEqual({ language: "ru", requestedLanguage: "ru" });
    expect(answerPresentation("В окне\nAnswer in Russian.")).toEqual({ language: "ru", requestedLanguage: "ru" });
    expect(answerPresentation("Не нужно\nОтветь по-русски.").requestedLanguage).toBeUndefined();
  });
  it.each(["retained", "legacy"] as const)("preserves the %s original directive grammar", scope => {
    for (const instruction of positive) expect(answerPresentation(instruction, scope).requestedLanguage).toBeUndefined();
  });
  it("does not turn a Russian request into an English word budget or change an original", () => {
    const question = "Ответь по-русски. Answer in at most 40 words. Original <source> {count}.";
    expect(answerPresentation(question)).toEqual({ language: "ru", requestedLanguage: "ru" });
    expect(answerPresentation("Answer in Russian. Give 2 short bullets.").requestedBulletCount).toBe(2);
  });
});

it("separates exact Russian observation from regional system labels and unsupported scripts", () => {
  expect(presentationLanguage("ru")).toBe("ru");
  expect(isPresentationLanguage("ru")).toBe(true);
  for (const alias of ["ru-RU", "ru_RU", "Russian", "RU", "ru-Cyrl", "uk", "be", "constructor", "__proto__"]) {
    expect(presentationLanguage(alias)).toBeUndefined();
    expect(isPresentationLanguage(alias)).toBe(false);
  }
  expect(systemPresentationLanguage("ru-RU")).toBe("ru");
  expect(systemPresentationLanguage("uk-UA")).toBeUndefined();
});
