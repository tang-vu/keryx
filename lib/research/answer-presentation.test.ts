import { describe, expect, it } from "vitest";
import { answerPresentation, presentationStatementGuidance } from "./answer-presentation";

describe("original caller presentation", () => {
  it.each([
    ["Em português brasileiro, escreva três tópicos curtos explicando o comportamento.", "pt", 3],
    ["Explain in three short bullets. Answer in Brazilian Portuguese.", "pt", 3],
    ["Hãy viết 3 gạch đầu dòng ngắn. Answer in English.", "en", 3],
    ["Sou professora e preciso de uma explicação. Responda em inglês.", "en", undefined],
    ["Write two brief bullet points. Reply in Vietnamese.", "vi", 2],
    ["Write three short bullets, then four short bullets.", "en", undefined],
    ["Write 9 short bullets.", "en", undefined],
    ["Write 3 bullets.", "en", undefined],
    ["Do not write three short bullets. Do not answer in Portuguese.", "en", undefined],
    ["Explain HTML. Do not answer in Vietnamese.", "en", undefined],
    ["Write in English, sem português.", "en", undefined],
  ])("parses positive bounded instructions: %s", (question, language, count) => {
    expect(answerPresentation(question as string)).toMatchObject({ language,
      ...(count ? { requestedBulletCount: count } : {}) });
    expect(answerPresentation(question as string).requestedBulletCount).toBe(count);
  });

  it.each(["En français, expliquez les trois types.", "Answer in German. Explain the three types.",
    "Explain HTML. Do not answer in Vietnamese.", "Write in English. Then reply in French."])("preserves existing statement-language guidance for unsupported or negated requests: %s", question => {
    expect(presentationStatementGuidance(answerPresentation(question))).toBe("");
  });

  it("uses the last positive explicit language request before statement review", () => {
    const presentation = answerPresentation("Write in Portuguese. Reply in English.");
    expect(presentation.language).toBe("en");
    expect(presentationStatementGuidance(presentation)).toContain("write each statement in English");
    expect(presentationStatementGuidance(presentation)).toContain("takes precedence");
  });

  it.each([
    ["En español, escriba una nota breve de tres frases: explique el resultado.", 3],
    ["En español, escribe una respuesta breve de 2 oraciones.", 2],
    ["En español, escriba una nota breve de una oración.", 1],
    ["En español, escriba una nota breve de ocho frases.", 8],
    ["No escriba una nota breve de tres frases.", undefined],
    ["Nunca escriba una nota breve de tres frases.", undefined],
    ["En español, la página dice: «escriba una nota breve de tres frases».", undefined],
    ['En español, "escriba una nota breve de tres frases."', undefined],
    ["En español, cite la instrucción escriba una nota breve de tres frases.", undefined],
    ["En español, escriba una nota breve de tres frases. Escriba una nota breve de cuatro frases.", undefined],
    ["En español, escriba una nota breve de tres frases. Escriba una nota breve de nueve frases.", undefined],
    ["En español, escriba una nota breve de tres o cuatro frases.", undefined],
    ["En español, escriba una nota breve de tres frases o cuatro frases.", undefined],
    ["En español, escriba una nota breve de 3-4 frases.", undefined],
    ["En español, escriba una nota breve de nueve frases.", undefined],
    ["En español, escriba una nota breve de 9 frases.", undefined],
    ["En español, escriba una nota breve de tres frases. Write three short bullets.", undefined],
    ["Answer in English. Escriba una nota breve de tres frases.", undefined],
    ["En français, escriba una nota breve de tres frases.", undefined],
  ])("admits only finite positive caller-original Spanish note instructions: %s", (question, count) => {
    expect(answerPresentation(question as string).requestedSentenceCount).toBe(count);
    expect(answerPresentation(question as string, "retained").requestedSentenceCount).toBeUndefined();
  });
});
