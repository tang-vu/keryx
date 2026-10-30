import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AnswerMarkdown } from "../../components/keryx/answer-markdown";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { selectCitedStatements } from "../agent/cited-statements";
import { finalizeGroundedAnswer } from "../agent/answer-grounding";
import { researchFollowUp } from "../agent/research-follow-up";
import { publicReadRecoveryLines } from "../agent/read-recovery";
import { synthesisFailureDetail } from "../agent/synthesis-failure";
import { JsonChatEngine } from "../llm/json-chat-engine";
import { applyEvidenceReview } from "../llm/evidence-review";
import type { ProposedEvidence, SynthInput } from "../llm/reasoning-engine";
import { answerPresentation, presentationStatementGuidance } from "./answer-presentation";
import { trustedAnswerPresentation } from "./trusted-answer-presentation";
import { languageReviewedProposals, reviewedStatementLanguage } from "./answer-language-review";
import { finalizeAnswerLanguage, projectCompletedAnswerLanguage, readCompletedAnswerLanguage, recordedAnswerLanguage } from "./answer-language-provenance";
import { confidenceBanner, evidenceConfidenceReason, ordinaryConfidence } from "./confidence-copy";
import { apiIntegrationNote } from "./api-integration-note";
import { archiveAnswerSnippet } from "../answers-archive";
import { pdfReadingFrench } from "../../locales/fr/pdf-reading";

const target = "Original target <scope> {count} 日本語";
const quote = "The synthetic policy requires one documented safeguard, with a stated exception.";
const statement = "La règle exige une mesure documentée, avec une exception précisée.";
const source = { sourceId: "synthetic-french", sourceName: "Original source <literal> 日本語", marker: "S1",
  sourceKind: "public-reference" as const, text: quote };
const proposal: ProposedEvidence = { claimIndex: 0, marker: "S1", quote,
  quoteSpan: { start: 0, end: quote.length }, support: 0.9, statement, statementSupport: 0.9 };
function reviewed(language: unknown) {
  return applyEvidenceReview([proposal], { reviews: [{ index: 0, support: 0.9, statementSupport: 0.9, statementLanguage: language }] }, new Set([0]), true);
}
function fixture(rows = reviewed("fr"), coverage = 0.9) {
  const ledger = buildEvidenceLedger({ subClaims: [target], gathered: [source], answer: "Unreviewed draft [S1]",
    declaredMarkers: ["S1"], proposedEvidence: rows, finalAssessment: [{ claim: target, coverage, coveredBy: ["S1"] }] });
  const statements = selectCitedStatements(languageReviewedProposals(rows, "fr"), ledger);
  const answer = finalizeGroundedAnswer({ question: "Répondez en français. Explain the policy.", answer: "Unreviewed draft [S1]",
    ledger, statements, presentation: { language: "fr", requestedLanguage: "fr" } });
  return { ledger, statements, answer, rows };
}

describe("finite French ordinary answer intent", () => {
  it.each(["Answer in French. Explain the policy.", "Reply using French. Explain the policy.",
    "Réponds en français. Explique la règle.", "Répondez uniquement en français. Expliquez la règle.",
    "Écrivez en français. Expliquez la règle.", "En français, expliquez la règle.",
    "Trả lời bằng tiếng Pháp. Giải thích quy tắc.", "Responda em francês. Explique a regra."])("supports an explicit original request: %s", question => {
    const original = question;
    expect(answerPresentation(question)).toMatchObject({ language: "fr", requestedLanguage: "fr" });
    expect(presentationStatementGuidance(answerPresentation(question))).toContain("write each statement in French");
    expect(question).toBe(original);
    expect(answerPresentation(question, "retained").requestedLanguage).toBeUndefined();
    expect(answerPresentation(question, "retained").language).toBe("en");
  });
  it.each(['Read the phrase "Answer in French."', 'Review «Répondez en français.»',
    'Read “A title. En français, expliquez.”', "Do not\nanswer in French.",
    "Ne\nrépondez en français.", "Ne répondez pas en français.", "Pas\nen français, merci.",
    "Write in Italian. Explain the policy."])("keeps quoted, negated or unsupported intent outside French: %s", question => {
    expect(answerPresentation(question).requestedLanguage).toBeUndefined();
    expect(presentationStatementGuidance(answerPresentation(question))).toBe("");
  });
  it("uses the last positive directive and gives an original supported directive priority over a trusted preference", () => {
    expect(answerPresentation("Answer in English. Répondez en français.")).toMatchObject({ language: "fr" });
    expect(answerPresentation("Répondez en français. Do not answer in English.")).toMatchObject({ language: "fr" });
    expect(answerPresentation("Répondez en français. Reply in English.")).toMatchObject({ language: "en", requestedLanguage: "en" });
    expect(answerPresentation("Répondez en français. In English, give a note. Keep the note within 180 words."))
      .toMatchObject({ language: "en", requestedLanguage: "en", requestedMaximumWords: 180 });
    expect(answerPresentation("Write in Portuguese. In English, give a note.", "retained")).toMatchObject({ language: "pt", requestedLanguage: "pt" });
    expect(answerPresentation("Write in Portuguese. In English, give a note.", "legacy")).toMatchObject({ language: "pt", requestedLanguage: "pt" });
    expect(answerPresentation("Write in Portuguese. Répondez en français.", "legacy")).toMatchObject({ language: "pt", requestedLanguage: "pt" });
    expect(answerPresentation("Write in Portuguese. Répondez en français.", "retained")).toMatchObject({ language: "pt", requestedLanguage: "pt" });
    expect(answerPresentation("En español, explique la regla.", "legacy")).toMatchObject({ language: "es", requestedLanguage: "es" });
    expect(answerPresentation("Répondez en français. Answer in at most 180 words."))
      .toMatchObject({ language: "fr", requestedLanguage: "fr" });
    expect(answerPresentation("Répondez en français. Answer in at most 180 words.").requestedMaximumWords).toBeUndefined();
    expect(trustedAnswerPresentation(answerPresentation("Answer in English. Explain the policy."), "fr").language).toBe("en");
    expect(trustedAnswerPresentation(answerPresentation("Explain the policy."), "fr")).toMatchObject({ language: "fr", requestedLanguage: "fr" });
    expect(answerPresentation("Pas de problème\nRépondez en français.").language).toBe("fr");
  });
});

class SyntheticFrenchEngine extends JsonChatEngine {
  readonly name = "synthetic-french-review";
  packets: { system: string; data: Record<string, unknown> }[] = [];
  protected async chatJson(_model: string, system: string, user: string) {
    const data = JSON.parse(user); this.packets.push({ system, data });
    if (this.packets.length === 2) return { reviews: [{ index: 0, supportedFact: "The policy has a safeguard and an exception.",
      support: 0.9, statementSupport: 0.9, statementLanguage: "fr" }] };
    const option = (data.quoteOptions as { quoteId: string; marker: string }[])[0];
    return { evidence: [{ claimIndex: 0, marker: option.marker, quoteId: option.quoteId, support: 0.9, statement }], conflicts: [] };
  }
}

it("generates French guidance before the same independent bounded review, then delivers actual reviewed sentences and original excerpts", async () => {
  const input: SynthInput = { question: "Répondez en français. Explain the policy.", subClaims: [target], gathered: [source],
    generationFormat: "evidence-only", observeAnswerLanguage: true, answerPresentation: { language: "fr", requestedLanguage: "fr" } };
  const engine = new SyntheticFrenchEngine(), result = await engine.synthesize(input);
  expect(engine.packets).toHaveLength(2);
  expect(engine.packets[0].system).toContain("write each statement in French");
  expect(engine.packets[1].system).toContain("a requested language or prompt does not prove");
  expect(engine.packets[1].data.schema).toContain('"fr"|"zh-Hans"|"de"|"ja"|"ko"|"hi"|"id"|"ru"|"ar"|"UNKNOWN"');
  expect(reviewedStatementLanguage(result.evidence[0])).toBe("fr");
  const built = fixture(result.evidence);
  expect(built.answer).toContain(statement);
  expect(built.answer).toContain(`Texte de la source : “${quote}”`);
  expect(built.answer).toContain(target);
  expect(built.answer).not.toContain("Unreviewed draft");
  expect(built.ledger.evidence[0].quote).toBe(quote);
  const before = JSON.stringify(built.ledger, (_key, value) => value instanceof Set ? [...value] : value);
  expect(apiIntegrationNote({ ...built, language: "fr" })).toContain("Note d'intégration API");
  expect(JSON.stringify(built.ledger, (_key, value) => value instanceof Set ? [...value] : value)).toBe(before);
});

it.each([undefined, "UNKNOWN", "en", "fr-FR", "pt-BR", "de"])("withholds nonmatching %s sentence language while preserving qualified source evidence", observation => {
  const built = fixture(reviewed(observation));
  expect(built.statements).toEqual([]);
  expect(built.answer).not.toContain(statement);
  expect(built.answer).toContain(quote);
  expect(built.answer).toContain("Extraits des sources uniquement");
  expect(built.ledger.evidence[0].quote).toBe(quote);
  expect(built.ledger.acceptedMarkers.has("S1")).toBe(true);
});

it("binds French final prose to exact final bytes and query, preserving unknown originals and snapshot authority", () => {
  const built = fixture();
  const packet = finalizeAnswerLanguage({ ...built, rendererLanguage: "fr", proposals: built.rows })!;
  expect(packet.language).toBe("fr");
  const run = { id: "french-original-query", answer: built.answer, trace: [{ phase: "done" as const, ts: 0, message: "Synthetic review", detail: { answerLanguage: packet } }] };
  expect(recordedAnswerLanguage(run)).toBe("fr");
  const completed = projectCompletedAnswerLanguage(run)!;
  expect(readCompletedAnswerLanguage(completed, run.id, run.answer)).toEqual(completed);
  expect(readCompletedAnswerLanguage(completed, "foreign", run.answer)).toBeUndefined();
  expect(readCompletedAnswerLanguage(completed, run.id, run.answer + " ")).toBeUndefined();
  expect(recordedAnswerLanguage({ ...run, trace: [] })).toBeUndefined();
  expect(finalizeAnswerLanguage({ ...built, rendererLanguage: "fr", proposals: structuredClone(built.rows) })).toBeUndefined();
  const html = renderToStaticMarkup(createElement(AnswerMarkdown, { text: built.answer, citations: [], language: packet.language }));
  expect(html).toContain('lang="fr"');
  expect(html).toContain(`<bdi lang="und" dir="auto">“${quote}”</bdi>`);
  built.rows[0].statement += " Changed.";
  expect(reviewedStatementLanguage(built.rows[0])).toBeUndefined();
});

it("keeps French gap, unavailable and confidence limits explicit without translating original targets", () => {
  const { ledger } = fixture([], 0), original = JSON.stringify(ledger);
  const answer = finalizeGroundedAnswer({ question: "Répondez en français.", answer: "Unsupported draft", ledger,
    presentation: { language: "fr" }, synthesisUnavailable: true });
  expect(answer).toContain("Aucune réponse étayée");
  expect(answer).toContain("n'ont pas pu être évaluées");
  expect(answer).toContain(target);
  expect(answer).not.toContain("Unsupported draft");
  expect(JSON.stringify(ledger)).toBe(original);
  for (const delivery of ["unavailable", "excerpts"] as const) {
    const verdict = ordinaryConfidence("fr", delivery, "Évaluation limitée", { level: "High", reason: "Not admitted" });
    expect(verdict.level).toBe("Low");
    expect(verdict.reason).not.toContain("Not admitted");
    expect(confidenceBanner(answer, verdict, "fr")).toContain("Confiance faible");
  }
  for (const kind of ["synthetic", "no-citation", "no-coverage", "incomplete", "explained-conflict"] as const)
    expect(evidenceConfidenceReason("fr", { kind })).toBeTruthy();
  for (const kind of ["unresolved-conflict", "gaps", "publisher-groups", "limited-sources"] as const)
    for (const count of [1, 2]) expect(evidenceConfidenceReason("fr", { kind, count })).toContain(String(count));
  const built = fixture(), banner = confidenceBanner(built.answer, { level: "Low", reason: "Synthèse incomplète" }, "fr");
  const preview = archiveAnswerSnippet(banner);
  expect(preview).toContain("⚠ Confiance faible");
  expect(preview).toContain(statement);
  expect(preview).not.toContain("Résumé rédigé par un modèle");
});

it("renders or refuses a French compact request without dropping an original target, excerpt or reviewed statement", () => {
  const built = fixture();
  const input = { question: "Répondez en français.", answer: "Unreviewed draft", ledger: built.ledger, statements: built.statements };
  const compact = finalizeGroundedAnswer({ ...input, presentation: { language: "fr", requestedBulletCount: 1 } });
  expect(compact.match(/^- /gm)).toHaveLength(1);
  expect(compact).toContain(`${statement} [S1] Texte de la source: “${quote}”`);
  expect(compact).toContain("Résumés rédigés et vérifiés par des modèles");
  const refused = finalizeGroundedAnswer({ ...input, presentation: { language: "fr", requestedBulletCount: 2 } });
  expect(refused).toContain("Impossible de présenter 2 points courts");
  expect(refused).toContain(target);
  expect(refused).toContain(statement);
  expect(refused).toContain(quote);
});

it("uses the existing observed PDF scope and bounded recovery without authorizing any follow-up or payment", () => {
  const draft = JSON.parse(readFileSync(new URL('../../locales/fr/ui-drafts/pdf-reading.json', import.meta.url), 'utf8'));
  expect(pdfReadingFrench).toEqual(Object.fromEntries(Object.entries(draft.entries).map(([key, value]) => [key, (value as { text: string }).text])));
  const scope = { format: "keryx-pdf-text-scope-v1" as const, pagesRead: 3, totalPages: 5, pagesWithoutText: [2], textLimitReached: false };
  const input = { vi: false, language: "fr" as const, outcomes: [{ name: "Original PDF", code: "pdf-extraction-unavailable" }],
    gathered: [{ ...source, webProvenance: { retrievedAt: "2026-10-28T00:00:00Z", publisherGroup: "synthetic.example",
      normalizedBodyHash: "synthetic", extraction: "pdf" as const, truncated: true, pdfTextScope: scope } }], conflicts: [], paymentReviewRequired: true };
  const before = JSON.stringify(input), followUp = researchFollowUp(input);
  expect(followUp).toContain("Étapes suivantes");
  expect(followUp).toContain("3 pages sur 5");
  expect(followUp).toContain("n'a pas effectué d'OCR");
  expect(followUp).toContain("Before any new paid attempt, inspect this job's original payment receipts");
  expect(JSON.stringify(input)).toBe(before);
  const outcomes = Array.from({ length: 11 }, (_, i) => ({ name: `Original${i}`, code: "unknown-new-code" }));
  const rows = publicReadRecoveryLines([...outcomes, outcomes[0]], false, true);
  expect(rows).toHaveLength(9);
  expect(rows.at(-1)).toContain("3 autres échecs");
  expect(rows[0]).toContain("ne prouve pas que le document n'existe pas");
  for (const stage of ["input", "generation", "review", "synthesis"] as const) {
    expect(synthesisFailureDetail(stage, 1, false, true)).toContain("ne prouve pas");
    expect(synthesisFailureDetail(stage, 0, false, true)).toBe("");
  }
});
