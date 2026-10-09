import { describe, expect, it } from "vitest";
import { answerPresentation, presentationStatementGuidance } from "./answer-presentation";
import { finalizeGroundedAnswer } from "../agent/answer-grounding";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { selectCitedStatements } from "../agent/cited-statements";

// Public frozen request from issue231; no NASA/network/model read is performed.
const spanishQuestion = 'Soy verificador de información científica en México. Lea https://science.nasa.gov/moon/facts/, en especial "Orbit and Rotation". En español, escriba una nota breve de tres frases: explique si la Luna gira sobre su eje, por qué normalmente vemos el mismo hemisferio desde la Tierra y por qué llamar a la cara lejana "siempre oscura" es engañoso. Cite pasajes inspeccionables de esa página de NASA. No presente una lectura de texto como observación o experimento propio.';

describe("ordinary scaffold language fallback", () => {
  it.each([
    spanishQuestion,
    "Explique si la Luna gira sobre su eje y para qué sirve esa explicación.",
    "Preciso información sobre la Luna para esta investigación.",
    "Sou professora e preciso de uma explicação. Reply in Spanish.",
    "Sou professora e preciso de uma explicação. En español, responde brevemente.",
    "Sou professora e preciso de uma explicação. Responda en español.",
    "Sou professora e preciso de uma explicação. En français, expliquez le comportement.",
    "Sou professora e preciso de uma explicação. Antworte auf Deutsch.",
    "Sou professora e preciso de uma explicação. Write in Klingon.",
  ])("does not infer Portuguese for unsupported or ambiguous output: %s", question => {
    const presentation = answerPresentation(question);
    expect(presentation.language).toBe("en");
    expect(presentation.requestedLanguage).toBeUndefined();
    expect(presentationStatementGuidance(presentation)).toBe("");
  });

  it.each([
    ["Sou professora e preciso de uma explicação.", "pt"],
    ["Preciso de uma explicação sobre a Lua.", "pt"],
    ["Explique uma questão sobre a Lua.", "pt"],
    ["Write in Portuguese. Do not reply in Spanish.", "pt"],
    ["Write in Portuguese. No responda en español.", "pt"],
    ["Write in Portuguese. Pas en français, s'il vous plaît.", "pt"],
    ["Write in Portuguese. Nicht auf Deutsch.", "pt"],
    ["Sou professora e preciso de uma explicação. The source mentions en español as a phrase.", "pt"],
    ["No problem. Answer in Portuguese.", "pt"],
    ["No Spanish; write in Portuguese.", "pt"],
    ['Write in Portuguese. The source uses the phrase "en español," in its title.', "pt"],
    ['Write in Portuguese. Review the page titled "Auf Deutsch".', "pt"],
    ['Write in Portuguese. Review the phrase "Responda en español."', "pt"],
    ['Write in Portuguese. Review the title "A note. En español,".', "pt"],
    ['Write in Portuguese. Review the quoted text “A note:\nEn français, expliquez.”', "pt"],
    ["Write in Portuguese. Review the title 'A note. Auf Deutsch'.", "pt"],
    ["Sou professora e preciso de uma explicação. Write in French. Reply in Vietnamese.", "vi"],
  ])("retains supported cues and positive-request precedence: %s", (question, language) => {
    expect(answerPresentation(question).language).toBe(language);
  });

  it("keeps an explicit short-bullet request after an unrelated negative sentence", () => {
    expect(answerPresentation("No problem. Write one short bullet.")).toEqual({language: "en", requestedBulletCount: 1});
  });

  it.each(["\n", "\r\n", "\u2028", "\u2029"])("keeps a new positive clause after a negative discourse line (%j)", separator => {
    expect(answerPresentation(`No thanks${separator}Answer in Portuguese.`)).toEqual({language: "pt", requestedLanguage: "pt"});
    expect(answerPresentation(`No thanks${separator}Write one short bullet.`)).toEqual({language: "en", requestedBulletCount: 1});
    const fallback = answerPresentation(`Sou professora e preciso de uma explicação. No thanks${separator}En español, responde brevemente.`);
    expect(fallback).toEqual({language: "en"});
    expect(presentationStatementGuidance(fallback)).toBe("");
  });

  it.each([
    "Do not\nanswer in Portuguese.",
    "Don't\r\nreply in Vietnamese.",
    "Do not write\none short bullet.",
  ])("preserves explicit wrapped English negation: %s", question => {
    expect(answerPresentation(question)).toEqual({language: "en"});
  });

  it.each(["\n", "\r\n", "\u2028", "\u2029"])("preserves bounded words in wrapped negative commands (%j)", separator => {
    expect(answerPresentation(`Do not${separator}explicitly answer in Portuguese.`)).toEqual({language: "en"});
    expect(answerPresentation(`Don't${separator}just reply in Vietnamese.`)).toEqual({language: "en"});
    expect(answerPresentation(`Do not write${separator}exactly one short bullet.`)).toEqual({language: "en"});
  });

  it.each(["\n", "\r\n", "\u2028", "\u2029"])("preserves explicit wrapped Portuguese/Vietnamese negation without crossing discourse (%j)", separator => {
    for (const negator of ["Não", "Nao"]) {
      expect(answerPresentation(`Write in Portuguese. ${negator}${separator}responda em inglês.`)).toEqual({language: "pt", requestedLanguage: "pt"});
      expect(answerPresentation(`${negator} escreva${separator}um tópico curto.`).requestedBulletCount).toBeUndefined();
      expect(answerPresentation(`${negator} escreva${separator}exatamente um tópico curto.`).requestedBulletCount).toBeUndefined();
      expect(answerPresentation(`${negator} obrigado${separator}Answer in Portuguese.`)).toEqual({language: "pt", requestedLanguage: "pt"});
      expect(answerPresentation(`${negator} obrigado${separator}Write one short bullet.`).requestedBulletCount).toBe(1);
    }
    expect(answerPresentation(`Viết bằng tiếng Việt. Không${separator}trả lời bằng tiếng Anh.`)).toEqual({language: "vi", requestedLanguage: "vi"});
    expect(answerPresentation(`Viết bằng tiếng Việt. Không chỉ${separator}trả lời bằng tiếng Anh.`)).toEqual({language: "vi", requestedLanguage: "vi"});
    expect(answerPresentation(`Không viết${separator}một gạch đầu dòng ngắn.`).requestedBulletCount).toBeUndefined();
    expect(answerPresentation(`Không cảm ơn${separator}Answer in Portuguese.`)).toEqual({language: "pt", requestedLanguage: "pt"});
    expect(answerPresentation(`Không cảm ơn${separator}Write one short bullet.`).requestedBulletCount).toBe(1);
    for (const directive of [`No${separator}responda en español.`, `Pas${separator}en français, expliquez.`, `Nicht${separator}auf Deutsch.`])
      expect(answerPresentation(`Write in Portuguese. ${directive}`)).toEqual({language: "pt", requestedLanguage: "pt"});
    expect(answerPresentation(`No gracias${separator}Answer in Portuguese.`)).toEqual({language: "pt", requestedLanguage: "pt"});
    expect(answerPresentation(`Pas de problème${separator}Answer in Portuguese.`)).toEqual({language: "pt", requestedLanguage: "pt"});
  });

  it("keeps the exact admitted quote, statement, markers and ledger while selecting the English scaffold fallback", () => {
    const quote = "Synthetic source text: the same side faces Earth.";
    const statement = "La misma cara mira hacia la Tierra.";
    const evidence = [{claimIndex: 0, marker: "S1", quote, quoteSpan: {start: 0, end: quote.length},
      support: 0.9, statement, statementSupport: 0.9}];
    const ledger = buildEvidenceLedger({subClaims: ["La rotación"], gathered: [
      {sourceId: "synthetic-moon", sourceName: "Synthetic Moon fixture", marker: "S1", text: quote},
    ], answer: "Withheld draft [S1]", declaredMarkers: ["S1"], proposedEvidence: evidence,
    finalAssessment: [{claim: "La rotación", coverage: 0.9, coveredBy: ["S1"]}]});
    expect(ledger.evidence).toHaveLength(1);
    const before = JSON.stringify(ledger, (_key, value) => value instanceof Set ? [...value] : value);
    const input = {question: spanishQuestion, answer: "Withheld draft [S1]", ledger,
      statements: selectCitedStatements(evidence, ledger)};
    const answer = finalizeGroundedAnswer({...input, presentation: answerPresentation(spanishQuestion)});
    expect(answer).toContain("Research target 1");
    expect(answer).not.toContain("Objetivo de pesquisa");
    expect(answer).toContain(`${statement} [S1] Source text: “${quote}”`);
    expect(JSON.stringify(ledger, (_key, value) => value instanceof Set ? [...value] : value)).toBe(before);
    // A private/retained call without ordinary presentation keeps its existing bytes.
    expect(finalizeGroundedAnswer(input)).toBe(answer);
  });
});
