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
