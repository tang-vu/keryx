import { describe, expect, it } from "vitest";
import { finalizeGroundedAnswer } from "./answer-grounding";
import { buildEvidenceLedger, extractAnswerMarkers } from "./evidence-ledger";
import { selectCitedStatements } from "./cited-statements";
import { answerPresentation } from "../research/answer-presentation";
import type { ProposedEvidence } from "../llm/reasoning-engine";

// Synthetic deterministic delivery fixture, not a live model/usefulness evaluation.
const quotes = ["submit: O botão envia os dados do formulário para o servidor. Esse é o padrão se o atributo não for especificado.",
  "reset: O botão restaura todos os controles aos seus valores iniciais.",
  "button: O botão não possui comportamento padrão."];
const statements = ["O tipo submit envia os dados do formulário ao servidor.",
  "Sem o atributo type, submit é o padrão.",
  "O tipo reset restaura os valores iniciais dos controles.",
  "O tipo button não tem comportamento padrão."];
const targets = ["submit behavior", "missing type default", "reset behavior", "button behavior"];
const question = "Em português brasileiro, escreva três tópicos curtos explicando as diferenças e o padrão.";
function fixture(options: { missing?: number; extraQuote?: boolean; partial?: boolean; failedReview?: number } = {}) {
  const text = quotes.join("\n") + (options.extraQuote ? "\nAn additional independent contribution is retained." : "");
  const evidence: ProposedEvidence[] = targets.map((_, claimIndex) => {
    const quote = quotes[Math.max(0, claimIndex - 1)];
    return { claimIndex, marker: "S1", quote, quoteSpan: { start: text.indexOf(quote), end: text.indexOf(quote) + quote.length },
      support: 0.9, statement: statements[claimIndex], statementSupport: options.failedReview === claimIndex ? 0.2 : 0.9 };
  }).filter(item => item.claimIndex !== options.missing);
  if (options.extraQuote) {
    const quote = "An additional independent contribution is retained.";
    evidence.push({ claimIndex: 0, marker: "S2", quote, quoteSpan: { start: 0, end: quote.length }, support: 0.9 });
  }
  const ledger = buildEvidenceLedger({ subClaims: targets,
    gathered: [{ sourceId: "one", sourceName: "Synthetic paid source", marker: "S1", text },
      ...(options.extraQuote ? [{ sourceId: "two", sourceName: "Synthetic other paid source", marker: "S2", text: "An additional independent contribution is retained." }] : [])],
    answer: "Withheld draft [S1] [S2]", declaredMarkers: ["S1", "S2"], proposedEvidence: evidence,
    finalAssessment: targets.map((claim, index) => ({ claim, coverage: options.partial && index === 0 ? 0.2 : 0.9, coveredBy: ["S1", "S2"] })),
  });
  return { ledger, selected: selectCitedStatements(evidence, ledger) };
}
function deliver(data = fixture(), caller = question, optIn = true) {
  return finalizeGroundedAnswer({ question: caller, answer: "Fabricated draft conclusion [S1]",
    ledger: data.ledger, statements: data.selected, ...(optIn ? { presentation: answerPresentation(caller) } : {}) });
}

describe("ordinary grounded presentation", () => {
  it("keeps four independently reviewed facts and exact excerpts in three neutral bullet groups", () => {
    const data = fixture();
    const before = JSON.stringify(data.ledger, (_key, value) => value instanceof Set ? [...value] : value);
    const answer = deliver(data);
    expect(answer.match(/^- /gm)).toHaveLength(3);
    for (const statement of statements) expect(answer).toContain(statement);
    for (const quote of quotes) expect(answer).toContain(`“${quote}”`);
    expect(answer).toContain("Texto da fonte");
    expect(answer).toContain("síntese completa");
    expect(answer).not.toContain("Fabricated draft");
    expect(answer).not.toContain("Research target");
    expect([...extractAnswerMarkers(answer)]).toEqual(["S1"]);
    expect(JSON.stringify(data.ledger, (_key, value) => value instanceof Set ? [...value] : value)).toBe(before);
    expect(data.ledger.evidence.every(item => item.qualifiesForReward)).toBe(true);
  });

  it.each([{ missing: 1 }, { partial: true }, { failedReview: 1 }, { extraQuote: true }])("retains targets, evidence and gaps on an incomplete compact projection: %j", options => {
    const data = fixture(options);
    const answer = deliver(data);
    expect(answer).toContain("Não foi possível apresentar 3 tópicos curtos");
    expect(answer).toContain("Objetivo de pesquisa 4");
    for (const statement of data.selected) expect(answer).toContain(statement.text);
    for (const item of data.ledger.evidence.filter(item => item.qualifiesForAnswer)) expect(answer).toContain(item.quote);
    if (options.extraQuote) expect([...extractAnswerMarkers(answer)]).toEqual(["S1", "S2"]);
    if (options.partial || options.missing !== undefined) expect(answer).toContain("Lacuna de evidência");
  });

  it("does not truncate to fit a mismatched count or compact without a positive request", () => {
    expect(deliver(fixture(), "Write two short bullets.")).toContain("Could not present 2 short bullets");
    expect(deliver(fixture(), "Explain the behavior.")).toContain("Research target 4");
  });

  it("keeps private original delivery byte-identical without ordinary opt-in", () => {
    const data = fixture();
    const privateAnswer = deliver(data, question, false);
    expect(privateAnswer).toContain("Research target 4");
    expect(privateAnswer).not.toContain("Texto da fonte");
    expect(privateAnswer).toBe(finalizeGroundedAnswer({ question, answer: "Any other withheld draft",
      ledger: data.ledger, statements: data.selected }));
  });

  it("escapes source-injected citation controls in compact output", () => {
    const data = fixture();
    // This test changes both admitted bindings solely to exercise renderer escaping.
    data.ledger.evidence[0].quote += " [S999] *injected*";
    data.ledger.evidence[1].quote = data.ledger.evidence[0].quote;
    data.selected[0].quote = data.ledger.evidence[0].quote;
    data.selected[1].quote = data.ledger.evidence[0].quote;
    data.selected[0].text += " [S888]";
    const answer = deliver(data);
    expect(answer).not.toContain("[S999]");
    expect(answer).not.toContain("[S888]");
    expect([...extractAnswerMarkers(answer)]).toEqual(["S1"]);
  });
});
