import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import nasa from "./fixtures/nasa-sentence-note-20261009.json";
import { answerPresentation } from "../research/answer-presentation";
import { finalizeGroundedAnswer } from "./answer-grounding";
import type { EvidenceLedger } from "./evidence-ledger";
import { compactSentenceNoteAnswer, completeAnswerSentenceSegments, finishSentenceNoteAnswer, withSentenceNoteNotices } from "./sentence-note-answer";

function retainedProjection() {
  const ledger: EvidenceLedger = { evidence: nasa.evidence.map(row => {
    if (row.sourceKind !== "public-reference") throw new Error("Retained public-reference fixture boundary changed");
    return { ...structuredClone(row), sourceKind: "public-reference" as const };
  }), claimCoverage: structuredClone(nasa.claimCoverage),
    acceptedMarkers: new Set(["S1"]), droppedEvidence: 0, droppedCitations: [] };
  return { ledger, statements: structuredClone(nasa.statements), confidence: { level: "Low" as const, reason: nasa.confidence.reason } };
}
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe("note prose and exact inspection appendix", () => {
  it("retains the actual five NASA pairs and original notices, honestly refusing the requested three", () => {
    expect(hash(nasa.question)).toBe("ac2a8909b023a9170cafe622d04539da5557155079d82602708d35cf0e1ccc1f");
    expect(hash(nasa.answer)).toBe("01f930beb5ce0e91061175f2dc94951400c974a62a63b7dc039dbb553acdcf77");
    expect(nasa.statements).toHaveLength(5);
    const data = retainedProjection(), before = JSON.stringify(data, (_key, value) => value instanceof Set ? [...value] : value);
    const presentation = answerPresentation(nasa.question);
    expect(presentation).toMatchObject({ language: "es", requestedSentenceCount: 3 });
    const suffix = nasa.answer.slice(nasa.answer.indexOf("### Next steps to complete this research"));
    const full = finalizeGroundedAnswer({ question: nasa.question, answer: "Withheld historical draft", ...data, presentation }) + "\n\n" + suffix;
    const compact = withSentenceNoteNotices(compactSentenceNoteAnswer(data.ledger, data.statements, data.confidence), body => body + "\n\n" + suffix)!;
    const delivered = finishSentenceNoteAnswer(full, compact, 3);
    expect(delivered.outcome).toBe("compact-unmet");
    expect(delivered.sentenceSegments).toBeGreaterThan(3);
    expect(delivered.sentenceSegments).toBe(completeAnswerSentenceSegments(delivered.answer));
    expect(delivered.answer).toContain("No fue posible presentar la nota en 3 frases");
    expect(delivered.noteSentenceCount).toBe(5);
    expect(full.match(/### Objetivo de investigación/g)).toHaveLength(3); // Default layout remains intact.
    expect(compact.answer).not.toContain("### Objetivo de investigación");
    expect(compact.answer).not.toContain("Tema solicitado (no verificado)");
    const noteProse = delivered.answer.split("### Nota — 5 frases\n\n")[1]!.split("### Apéndice de inspección")[0];
    for (const statement of data.statements) {
      const historicalSection = nasa.answer.split(`### Objetivo de pesquisa ${statement.claimIndex + 1}\n\n`)[1]?.split("### Objetivo de pesquisa ")[0];
      expect(historicalSection).toContain(`${statement.text} [S1] Texto da fonte: “${statement.quote}”`);
      expect(data.ledger.evidence.some(row => row.claimIndex === statement.claimIndex && row.marker === statement.marker && row.quote === statement.quote)).toBe(true);
      expect(delivered.answer.split("\n\n").filter(row => row.includes(statement.text))).toHaveLength(1);
      expect(noteProse).toContain(`${statement.text} [S1]`);
      expect(delivered.answer).toContain(`Texto de la fuente: “${statement.quote}”`);
    }
    // The repeated synchronous excerpt binds two DIFFERENT claims; retain both occurrences.
    expect(compact.answer.split(data.statements[0].quote)).toHaveLength(3);
    expect(delivered.answer).toContain(suffix);
    expect(delivered.answer).toContain(data.confidence.reason); // Historical rationale is not translated or reconstructed.
    expect(delivered.answer).toContain("Frases escritas y revisadas por modelos, sin verificación independiente.");
    expect(delivered.answer).toContain("no demuestran su exactitud ni una síntesis completa");
    expect(delivered.answer).toContain("Las fuentes pueden ser incorrectas o contradictorias.");
    expect(delivered.answer).toContain("Los pagos se registran por separado.");
    expect(JSON.stringify(data, (_key, value) => value instanceof Set ? [...value] : value)).toBe(before);
    expect(data.ledger.evidence.every(row => row.qualifiesForAnswer && !row.qualifiesForReward)).toBe(true);
  });
  it("refuses multiline, multi-sentence and unsafe Markdown note rows without dropping any content", () => {
    for (const text of ["Una frase completa. Otra frase añadida.", "Una frase\ncon un salto.", "Una frase con *formato*."]) {
      const data = retainedProjection();
      data.statements[0].text = text;
      expect(compactSentenceNoteAnswer(data.ledger, data.statements, data.confidence)).toBeUndefined();
      const full = finalizeGroundedAnswer({ question: nasa.question, answer: "Withheld draft", ...data, presentation: { language: "es" } });
      expect(finishSentenceNoteAnswer(full, undefined, 3)).toMatchObject({ outcome: "unmet" });
      expect(finishSentenceNoteAnswer(full, undefined, 3).answer).toContain(full);
    }
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
  it("keeps whole-output segmentation diagnostic and refuses arbitrary text or forged count certificates", () => {
    const body = 'Una frase. Texto de la fuente: “First sentence. Second sentence.”';
    const notices = "\n\nConfianza baja: sin verificación independiente.\n\nLa recuperación sigue pendiente. No se ha intentado otro pago.";
    const compact = body + notices;
    expect(completeAnswerSentenceSegments(compact)).toBeGreaterThan(completeAnswerSentenceSegments(body));
    expect(finishSentenceNoteAnswer(compact, { answer: compact, noteSentenceCount: 3 } as { answer: string }, completeAnswerSentenceSegments(body))).toMatchObject({ outcome: "unmet" });
    expect(finishSentenceNoteAnswer("Una frase.", undefined, 1).outcome).toBe("unmet");
    expect(finishSentenceNoteAnswer("Una frase.", undefined, 3).outcome).toBe("unmet"); // Never invent two filler sentences.
    expect(finishSentenceNoteAnswer("Una. Dos. Tres.", undefined, 3).outcome).toBe("unmet");
    const data = retainedProjection(), valid = compactSentenceNoteAnswer(data.ledger, data.statements, data.confidence)!;
    expect(withSentenceNoteNotices({ ...valid }, value => value + notices)).toBeUndefined();
    expect(withSentenceNoteNotices(valid, value => value.replace(data.statements[0].text, "Deleted."))).toBeUndefined();
    const preserved = withSentenceNoteNotices(valid, value => notices + value + notices)!;
    expect(finishSentenceNoteAnswer("Withheld", preserved, 5)).toMatchObject({ outcome: "compact", noteSentenceCount: 5 });
    expect(preserved.answer).toContain(notices + valid.answer + notices);
  });
});
