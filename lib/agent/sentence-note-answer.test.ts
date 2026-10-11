import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import nasa from "./fixtures/nasa-sentence-note-20261009.json";
import { answerPresentation } from "../research/answer-presentation";
import { finalizeGroundedAnswer } from "./answer-grounding";
import type { EvidenceLedger } from "./evidence-ledger";
import { compactSentenceNoteAnswer, completeAnswerSentenceSegments, finishSentenceNoteAnswer } from "./sentence-note-answer";

function retainedProjection() {
  const ledger: EvidenceLedger = { evidence: nasa.evidence.map(row => {
    if (row.sourceKind !== "public-reference") throw new Error("Retained public-reference fixture boundary changed");
    return { ...structuredClone(row), sourceKind: "public-reference" as const };
  }), claimCoverage: structuredClone(nasa.claimCoverage),
    acceptedMarkers: new Set(["S1"]), droppedEvidence: 0, droppedCitations: [] };
  return { ledger, statements: structuredClone(nasa.statements), confidence: { level: "Low" as const, reason: nasa.confidence.reason } };
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe("complete-answer sentence-note projection", () => {
  it("retains the actual five NASA pairs and original notices, honestly refusing the requested three", () => {
    expect(hash(nasa.question)).toBe("ac2a8909b023a9170cafe622d04539da5557155079d82602708d35cf0e1ccc1f");
    expect(hash(nasa.answer)).toBe("01f930beb5ce0e91061175f2dc94951400c974a62a63b7dc039dbb553acdcf77");
    expect(nasa.statements).toHaveLength(5);
    const data = retainedProjection(), before = JSON.stringify(data, (_key, value) => value instanceof Set ? [...value] : value);
    const presentation = answerPresentation(nasa.question);
    expect(presentation).toMatchObject({ language: "es", requestedSentenceCount: 3 });
    const suffix = nasa.answer.slice(nasa.answer.indexOf("### Next steps to complete this research"));
    const full = finalizeGroundedAnswer({ question: nasa.question, answer: "Withheld historical draft", ...data, presentation }) + "\n\n" + suffix;
    const compact = compactSentenceNoteAnswer(data.ledger, data.statements, data.confidence)! + "\n\n" + suffix;
    const delivered = finishSentenceNoteAnswer(full, compact, 3);
    expect(delivered.outcome).toBe("compact-unmet");
    expect(delivered.sentenceSegments).toBeGreaterThan(3);
    expect(delivered.sentenceSegments).toBe(completeAnswerSentenceSegments(delivered.answer));
    expect(delivered.answer).toContain("No fue posible presentar la respuesta completa en 3 frases");
    expect(full.match(/### Objetivo de investigación/g)).toHaveLength(3); // Default layout remains intact.
    expect(compact).not.toContain("### Objetivo de investigación");
    expect(compact).not.toContain("Tema solicitado (no verificado)");
    for (const statement of data.statements) {
      const historicalSection = nasa.answer.split(`### Objetivo de pesquisa ${statement.claimIndex + 1}\n\n`)[1]?.split("### Objetivo de pesquisa ")[0];
      expect(historicalSection).toContain(`${statement.text} [S1] Texto da fonte: “${statement.quote}”`);
      expect(data.ledger.evidence.some(row => row.claimIndex === statement.claimIndex && row.marker === statement.marker && row.quote === statement.quote)).toBe(true);
      expect(delivered.answer.split("\n\n").filter(row => row.includes(statement.text))).toHaveLength(1);
      expect(delivered.answer).toContain(`${statement.text} [S1] Texto de la fuente: “${statement.quote}”`);
    }
    // The repeated synchronous excerpt binds two DIFFERENT claims; retain both occurrences.
    expect(compact.split(data.statements[0].quote)).toHaveLength(3);
    expect(delivered.answer).toContain(suffix);
    expect(delivered.answer).toContain(data.confidence.reason); // Historical rationale is not translated or reconstructed.
    expect(delivered.answer).toContain("Frases escritas y revisadas por modelos, sin verificación independiente.");
    expect(delivered.answer).toContain("no demuestran su exactitud ni una síntesis completa");
    expect(delivered.answer).toContain("Las fuentes pueden ser incorrectas o contradictorias.");
    expect(delivered.answer).toContain("Los pagos se registran por separado.");
    expect(JSON.stringify(data, (_key, value) => value instanceof Set ? [...value] : value)).toBe(before);
    expect(data.ledger.evidence.every(row => row.qualifiesForAnswer && !row.qualifiesForReward)).toBe(true);
  });
  it("does not claim three complete sentences for a synthetic three-statement note either", () => {
    // Synthetic renderer fixture, NOT replacement acceptance for the five-pair NASA record.
    const data = retainedProjection();
    data.statements = [0, 2, 4].map(index => data.statements[index]);
    data.ledger.evidence = data.ledger.evidence.filter(row => data.statements.some(statement =>
      row.claimIndex === statement.claimIndex && row.quote === statement.quote));
    const compact = compactSentenceNoteAnswer(data.ledger, data.statements, data.confidence)!;
    const counted = finishSentenceNoteAnswer("Una. Dos. Tres. Cuatro.", compact, 3);
    expect(counted.outcome).toBe("compact-unmet");
    expect(counted.sentenceSegments).toBeGreaterThan(3);
    for (const row of data.statements) expect(counted.answer).toContain(row.text);
  });
  it.each(["gap", "partial", "unpaired", "extra-marker", "unbound-statement", "empty"])("keeps original gaps and scaffolding when compact closure fails: %s", mutation => {
    const data = retainedProjection();
    if (mutation === "gap") data.ledger.claimCoverage.push({ claimIndex: 3, claim: "Missing qualification", coverage: 0, coveredBy: [] });
    if (mutation === "partial") data.ledger.claimCoverage[0].coverage = 0.2;
    if (mutation === "unpaired") data.ledger.evidence.push({ ...data.ledger.evidence[0], quote: "An extra admitted qualification." });
    if (mutation === "extra-marker") data.ledger.acceptedMarkers.add("S2");
    if (mutation === "unbound-statement") data.statements.push({ ...data.statements[0], quote: "Unbound quote." });
    if (mutation === "empty") data.statements = [];
    expect(compactSentenceNoteAnswer(data.ledger, data.statements, data.confidence)).toBeUndefined();
    const full = finalizeGroundedAnswer({ question: nasa.question, answer: "Withheld draft", ...data, presentation: { language: "es" } });
    const delivered = finishSentenceNoteAnswer(full, undefined, 3);
    expect(delivered.outcome).toBe("unmet");
    expect(delivered.answer).toContain(full);
  });
  it("counts confidence, quoted English sentences, fragment labels and every operational notice", () => {
    const body = 'Una frase. Texto de la fuente: “First sentence. Second sentence.”';
    const notices = "\n\nConfianza baja: sin verificación independiente.\n\nLa recuperación sigue pendiente. No se ha intentado otro pago.";
    const compact = body + notices;
    expect(completeAnswerSentenceSegments(compact)).toBeGreaterThan(completeAnswerSentenceSegments(body));
    expect(finishSentenceNoteAnswer(compact, compact, completeAnswerSentenceSegments(body))).toMatchObject({ outcome: "compact-unmet" });
    expect(finishSentenceNoteAnswer("Una frase.", undefined, 1)).toEqual({ answer: "Una frase.", outcome: "unchanged", sentenceSegments: 1 });
    expect(finishSentenceNoteAnswer("Una frase.", undefined, 3).outcome).toBe("unmet"); // Never invent two filler sentences.
    // Pure segmentation fixture only; this does not bypass the admitted-pair/safety-copy renderer.
    expect(finishSentenceNoteAnswer("Una. Dos. Tres.", undefined, 3).outcome).toBe("unchanged");
  });
});
