import { describe, expect, it } from "vitest";
import { nativeAnswerInstructions } from "./native-answer-intent";
import { answerPresentation, presentationStatementGuidance } from "./answer-presentation";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pdfReadingCopy } from "../../locales/en/pdf-reading";
import { pdfReadingGerman } from "../../locales/de/pdf-reading";
import { pdfReadingJapanese } from "../../locales/ja/pdf-reading";
import { pdfReadingKorean } from "../../locales/ko/pdf-reading";
import { pdfReadingHindi } from "../../locales/hi/pdf-reading";
import { pdfReadingIndonesian } from "../../locales/id/pdf-reading";
import { nativeAnswerCopy, nativeCount } from "./native-answer-copy";
import type { AdditionalAnswerLanguage } from "./native-answer-intent";
import type { AnswerPresentation } from "./answer-presentation";
import { finalizeGroundedAnswer } from "../agent/answer-grounding";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { selectCitedStatements } from "../agent/cited-statements";
import { confidenceBanner, evidenceConfidenceReason, ordinaryConfidence } from "./confidence-copy";
import { normalizeStatement } from "../llm/cited-statement";
import { apiIntegrationNote } from "./api-integration-note";
import { JsonChatEngine } from "../llm/json-chat-engine";
import type { ProposedEvidence, SynthInput } from "../llm/reasoning-engine";
import { applyEvidenceReview } from "../llm/evidence-review";
import { languageReviewedProposals, reviewedStatementLanguage } from "./answer-language-review";
import { finalizeAnswerLanguage, projectCompletedAnswerLanguage, readCompletedAnswerLanguage, recordedAnswerLanguage } from "./answer-language-provenance";

const instructions = (question: string) => nativeAnswerInstructions(question.normalize("NFC"));
const last = (question: string) => instructions(question).filter(row => row.eligible).at(-1)?.language;

it.each([["de", pdfReadingGerman], ["ja", pdfReadingJapanese], ["ko", pdfReadingKorean],
  ["hi", pdfReadingHindi], ["id", pdfReadingIndonesian]] as const)("prepares exact bound %s PDF scope copy without activating it", (locale, copy) => {
  const draft = JSON.parse(readFileSync(`locales/${locale}/ui-drafts/pdf-reading.json`, "utf8"));
  expect(draft.status).toBe("machineDraft"); expect(draft.review).toBeNull();
  const source = readFileSync(draft.sourcePath, "utf8").replace(/\r\n?/gu, "\n");
  expect(createHash("sha256").update(source).digest("hex")).toBe(draft.sourceSha256);
  expect(Object.isFrozen(copy)).toBe(true);
  expect(Object.keys(copy).sort()).toEqual(Object.keys(pdfReadingCopy).sort());
  const fields = (text: string) => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map(match => match[1]).sort();
  for (const key of Object.keys(pdfReadingCopy) as (keyof typeof pdfReadingCopy)[]) {
    expect(copy[key]).toBe(draft.entries[key].text);
    expect(draft.entries[key].source).toBe(pdfReadingCopy[key]);
    expect(fields(copy[key])).toEqual(fields(pdfReadingCopy[key]));
  }
  expect(copy.recovery).toContain("OCR");
});

const prepared = (language: AdditionalAnswerLanguage, requestedBulletCount?: number): AnswerPresentation =>
  ({ language, requestedLanguage: language, ...(requestedBulletCount ? { requestedBulletCount } : {}) });
const nativeSentences = {
  ru: "Синтетическое правило требует документированной меры защиты и указывает исключение.",
  de: "Die synthetische Regel verlangt eine dokumentierte Schutzmaßnahme und nennt eine Ausnahme.",
  ja: "この合成された規則は記録された保護措置を求め、例外を定めています。",
  ko: "이 합성 규칙은 기록된 보호 조치를 요구하며 예외를 명시합니다.",
  hi: "यह कृत्रिम नियम एक दर्ज सुरक्षा उपाय की माँग करता है और एक अपवाद बताता है।",
  id: "Aturan sintetis ini mensyaratkan satu perlindungan terdokumentasi dan menyebutkan pengecualian.",
} as const;
function nativeFixture(language: AdditionalAnswerLanguage, options: { coverage?: number; extra?: boolean; noEvidence?: boolean } = {}) {
  const quote = "A regra sintética exige uma salvaguarda documentada, com uma exceção declarada.";
  const target = "Original target <literal> — 例外";
  const targets = [target, ...(options.extra ? ["Second original target — अपवाद"] : [])];
  const rows = options.noEvidence ? [] : [{ claimIndex: 0, marker: "S1", quote, support: 0.9,
    quoteSpan: { start: 0, end: quote.length }, statement: nativeSentences[language], statementSupport: 0.9 }];
  const ledger = buildEvidenceLedger({ subClaims: targets,
    gathered: [{ sourceId: "native-copy-synthetic", sourceName: "Original المصدر", marker: "S1", sourceKind: "public-reference", text: quote }],
    answer: "Unreviewed draft [S1]", declaredMarkers: ["S1"], proposedEvidence: rows,
    finalAssessment: targets.map((claim, index) => ({ claim, coverage: index === 0 ? options.coverage ?? 0.9 : 0, coveredBy: index === 0 ? ["S1"] : [] })) });
  return { ledger, quote, target, targets, statements: selectCitedStatements(rows, ledger) };
}

describe.each(["de", "ja", "ko", "hi", "id", "ru"] as const)("prepared %s ordinary renderer boundaries", language => {
  const copy = nativeAnswerCopy(language)!;
  const render = (built: ReturnType<typeof nativeFixture>, statements = built.statements, unavailable = false, count?: number) =>
    finalizeGroundedAnswer({ question: "Original request", answer: "Unreviewed draft [S1]", ledger: built.ledger, statements,
      synthesisUnavailable: unavailable, presentation: prepared(language, count) });

  it("keeps each admitted sentence beside its exact original quote and preserves the ledger", () => {
    const built = nativeFixture(language), before = JSON.stringify(built);
    const answer = render(built);
    expect(answer).toContain(`${nativeSentences[language]} [S1] ${copy.source}: “${built.quote}”`);
    expect(answer).toContain(built.target); expect(answer).toContain(copy.reviewNotice); expect(answer).toContain(copy.limitations);
    expect(answer).not.toContain("Unreviewed draft"); expect(JSON.stringify(built)).toBe(before);
    expect(built.ledger.acceptedMarkers.has("S1")).toBe(true);
    expect(built.ledger.evidence[0].qualifiesForReward).toBe(false);
  });
  it("withholds an unpaired statement and preserves the qualifying source as an excerpt", () => {
    const built = nativeFixture(language);
    const answer = render(built, [{ ...built.statements[0], quote: built.quote + " altered" }]);
    expect(answer).not.toContain(nativeSentences[language]); expect(answer).not.toContain("altered");
    expect(answer).toContain(copy.excerptIntro); expect(answer).toContain(built.quote);
  });
  it("keeps missing targets visible and declines compact layout when support is incomplete", () => {
    const built = nativeFixture(language, { extra: true }), answer = render(built, built.statements, false, 1);
    expect(answer).toContain(nativeCount(copy.compactNotice, 1));
    expect(answer).toContain(built.targets[1]); expect(answer).toContain(copy.gap);
    expect(answer).toContain(built.quote); expect(answer).toContain(nativeSentences[language]);
  });
  it("groups complete pairs without dropping original excerpts or adding conclusions", () => {
    const built = nativeFixture(language), answer = render(built, built.statements, false, 1);
    expect(answer.split("\n\n").filter(row => row.startsWith("- "))).toHaveLength(1);
    expect(answer).toContain(nativeSentences[language]); expect(answer).toContain(built.quote);
    expect(answer).toContain(copy.compactNote); expect(answer).not.toContain(copy.compactNotice);
  });
  it("keeps the below-threshold warning even when a source excerpt and reviewed sentence exist", () => {
    const built = nativeFixture(language, { coverage: 0.3 }), before = JSON.stringify(built);
    const answer = render(built, built.statements, false, 1);
    expect(answer).toContain(copy.partialGap); expect(answer).toContain(nativeCount(copy.compactNotice, 1));
    expect(answer).toContain(built.quote); expect(answer).toContain(nativeSentences[language]);
    expect(built.ledger.claimCoverage[0].coverage).toBe(0.3);
    expect(built.ledger.evidence[0].qualifiesForReward).toBe(false); expect(JSON.stringify(built)).toBe(before);
  });
  it("renders the API note from exact accepted pairs and labels the implementation check as a proposal", () => {
    const built = nativeFixture(language, { extra: true }), before = JSON.stringify(built);
    const answer = apiIntegrationNote({ answer: "Original answer [S1]", ...built, language: prepared(language).language });
    expect(answer).toContain(copy.integration.title); expect(answer).toContain(copy.integration.notice);
    expect(answer).toContain(nativeSentences[language]); expect(answer).toContain(`“${built.quote}”`);
    expect(answer).toContain(built.targets[1]); expect(answer).toContain(copy.integration.missing);
    expect(answer).toContain(copy.integration.check); expect(answer).toContain(copy.integration.bounded);
    expect(JSON.stringify(built)).toBe(before);
    expect(apiIntegrationNote({ answer: "Original answer [S1] [S99]", ...built, language: prepared(language).language })).toBeUndefined();
    expect(Object.isFrozen(copy.integration)).toBe(true);
  });
  it("keeps the API note's partial-support and excerpt-only limitations", () => {
    const built = nativeFixture(language, { coverage: 0.3 });
    const answer = apiIntegrationNote({ answer: "Original answer [S1]", ...built, statements: [], language: prepared(language).language });
    expect(answer).toContain(copy.integration.low); expect(answer).toContain(copy.integration.noSummary);
    expect(answer).not.toContain(nativeSentences[language]); expect(answer).toContain(built.quote);
  });
  it("separates unavailable assessment from assessed empty evidence", () => {
    const built = nativeFixture(language, { noEvidence: true });
    const unavailable = render(built, [], true), empty = render(built, []);
    expect(unavailable).toContain(copy.unavailableIntro); expect(unavailable).toContain(copy.unavailableGap);
    expect(unavailable).not.toContain(copy.gap);
    expect(empty).toContain(copy.emptyIntro); expect(empty).toContain(copy.gap);
    expect(empty).not.toContain(copy.unavailableGap);
    for (const answer of [unavailable, empty]) { expect(answer).toContain(built.target); expect(answer).toContain(copy.limitations); }
  });
  it("does not promote excerpt or unavailable delivery using a supplied High assessment", () => {
    const code = prepared(language).language;
    for (const delivery of ["excerpts", "unavailable"] as const) {
      const verdict = ordinaryConfidence(code, delivery, "Original assessment", { level: "High", reason: "Foreign promotion" });
      expect(verdict.level).toBe("Low"); expect(verdict.reason).toContain(copy.delivery[delivery]);
      expect(verdict.reason).not.toContain("Foreign promotion");
      expect(confidenceBanner("Exact answer", verdict, code)).toContain(copy.lowConfidence);
      expect(confidenceBanner("Exact answer", verdict, code)).toContain(copy.provisional);
    }
    expect(ordinaryConfidence(code, "summary", "Original assessment").level).toBe("Low");
    const reviewed = ordinaryConfidence(code, "summary", "Original assessment", { level: "Moderate", reason: "Exact reviewed assessment" });
    expect(reviewed.level).toBe("Moderate"); expect(reviewed.reason).toContain("Exact reviewed assessment");
    expect(confidenceBanner("Exact answer", reviewed, code)).toBe("Exact answer");
  });
  it("retains all nine confidence limitations and exact count interpolation", () => {
    const code = prepared(language).language;
    for (const kind of ["synthetic", "no-citation", "no-coverage", "incomplete", "explained-conflict"] as const)
      expect(evidenceConfidenceReason(code, { kind })).toBe(copy.confidence[kind]);
    for (const kind of ["unresolved-conflict", "gaps", "publisher-groups", "limited-sources"] as const) {
      expect(evidenceConfidenceReason(code, { kind, count: 7 })).toContain("7");
      expect(evidenceConfidenceReason(code, { kind, count: 7 })).not.toContain("{count}");
    }
    expect(copy.confidence["publisher-groups"]).toContain("DOI");
    expect(Object.isFrozen(copy)).toBe(true); expect(Object.isFrozen(copy.confidence)).toBe(true); expect(Object.isFrozen(copy.delivery)).toBe(true);
  });
});

it.each([undefined, null, "ja-JP", "de-DE", "hi-IN", "id-ID", "ko-KR", "constructor", "toString", "__proto__", "en", "zh-Hans"])(
  "does not grant prepared native copy to a regional alias or object key %s", language => {
    expect(nativeAnswerCopy(language)).toBeUndefined();
  });

it("preserves a Hindi sentence ending without adding punctuation or relaxing statement bounds", () => {
  const sentence = nativeSentences.hi;
  expect(normalizeStatement(sentence)).toBe(sentence);
  expect(normalizeStatement(`${sentence} [S1]`)).toBe(sentence);
  expect(normalizeStatement("छोटा।")).toBeUndefined();
  expect(normalizeStatement("अ".repeat(321) + "।")).toBeUndefined();
  for (const text of ["The original sentence.", "Câu gốc chưa đổi.", "A frase original.", "La frase original.", "La phrase originale.", "原始句子保持不变并保留限定条件。"])
    expect(normalizeStatement(text)).toBe(text);
  expect(normalizeStatement("An unfinished sentence")).toBe("An unfinished sentence.");
});

describe("finite native directives from the original ordinary request", () => {
  it.each([
    ["de", "Answer in German. Explain the exact original."],
    ["de", "Please reply using German. Explain the exact original."],
    ["de", "Antworte bitte auf Deutsch. Explain the exact original."],
    ["de", "Auf Deutsch, erkläre die Originalquelle."],
    ["ja", "Answer in Japanese. Explain the exact original."],
    ["ja", "日本語で回答してください。元の資料を説明してください。"],
    ["ja", "日本語で答えてください。"],
    ["ko", "Reply in Korean. Explain the exact original."],
    ["ko", "한국어로 답변해 주세요. 원문을 설명해 주세요."],
    ["ko", "한국어로 대답해주세요."],
    ["hi", "Write in Hindi. Explain the exact original."],
    ["hi", "कृपया हिंदी में उत्तर दें। मूल सामग्री समझाएँ।"],
    ["hi", "हिन्दी में जवाब दीजिए।"],
    ["id", "Respond using Indonesian. Explain the exact original."],
    ["id", "Tolong jawab dalam bahasa Indonesia. Jelaskan sumber asli."],
    ["id", "Mohon tulis dengan bahasa Indonesia."],
  ] as const)("recognizes %s original output instruction %s", (language, question) => {
    const before = question;
    expect(last(question)).toBe(language);
    expect(answerPresentation(question)).toEqual({ language, requestedLanguage: language });
    expect(presentationStatementGuidance(answerPresentation(question))).toContain({ de: "German", ja: "Japanese", ko: "Korean", hi: "Hindi", id: "Indonesian" }[language]);
    const row = instructions(question).find(row => row.eligible)!;
    expect(row.index).toBe(0); expect(row.end).toBeLessThanOrEqual(question.length);
    expect(question).toBe(before);
  });
  it.each([
    'Read "Answer in Japanese."', 'Read “A title. Reply in Korean.”',
    'Read „A title. Antworte auf Deutsch.“', 'Read »A title. Auf Deutsch, bitte.«',
    'Read 「日本語で回答してください。」', 'Read 『한국어로 답변해 주세요.』',
    'Read «हिंदी में उत्तर दें।»', 'Read `Tolong jawab dalam bahasa Indonesia.`',
    "Do not\nanswer in Japanese.", "Don't please reply in Korean.",
    "Nicht\nauf Deutsch.", "Jangan\ntolong jawab dalam bahasa Indonesia.",
    "मत\nहिंदी में उत्तर दें।", "日本語で回答しないでください。", "한국어로 답변하지 마세요.",
    "The source mentions Answer in Hindi as an example.", "Answer in Japanese-American English.",
    "Explain what an Indonesian source said.",
  ])("keeps quoted, negated, partial or mentioned output outside enrollment: %s", question => {
    expect(last(question)).toBeUndefined();
    expect(answerPresentation(question).requestedLanguage).toBeUndefined();
  });
  it.each([
    ["de", "en", "Antworte auf Deutsch. Antworte auf Englisch."],
    ["ja", "en", "日本語で回答してください。英語で回答してください。"],
    ["ko", "en", "한국어로 답변해 주세요. 영어로 답변해 주세요."],
    ["hi", "en", "हिंदी में उत्तर दें। अंग्रेज़ी में उत्तर दें।"],
    ["id", "en", "Jawab dalam bahasa Indonesia. Jawab dalam bahasa Inggris."],
    ["de", "ja", "Answer in German. 日本語で回答してください。"],
  ] as const)("keeps request order %s then %s", (first, final, question) => {
    expect(instructions(question).filter(row => row.eligible).map(row => row.language)).toEqual([first, final]);
    expect(last(question)).toBe(final);
    expect(answerPresentation(question).requestedLanguage).toBe(final);
  });
  it("retains refused spans for suppression without granting their language", () => {
    const question = 'Read “A title. Answer in Japanese.”';
    const spans = instructions(question);
    expect(spans).toHaveLength(1); expect(spans[0].eligible).toBe(false);
    expect(question.slice(spans[0].index, spans[0].end)).toBe("Answer in Japanese");
  });
  it("bounds scans and recognizes a later positive clause after a negative sentence", () => {
    expect(instructions(" ".repeat(30_000) + "Answer in Japanese.")).toEqual([]);
    expect(last("No thanks. Answer in German.")).toBe("de");
    expect(last("No thanks\nAnswer in Korean.")).toBe("ko");
  });
  it.each(["Answer in German.", "Answer in Japanese.", "Reply in Korean.", "Write in Hindi.", "Respond in Indonesian."])(
    "preserves retained and legacy producer grammar: %s", question => {
      for (const scope of ["retained", "legacy"] as const) expect(answerPresentation(question, scope)).toEqual({ language: "en" });
    });
  it.each([
    ["de", "Answer in German. Read『Answer in English.』"],
    ["ja", "Answer in Japanese. Read „Answer in French.“"],
    ["ko", "한국어로 답변해 주세요. Read «Answer in Russian.»"],
    ["hi", "हिंदी में उत्तर दें। Read「Answer in Portuguese.」"],
    ["id", "Jawab dalam bahasa Indonesia. Read »Answer in Vietnamese.«"],
    ["fr", "हिंदी में उत्तर दें। Répondez en français."],
  ] as const)("keeps actual original precedence and quoted data for %s", (language, question) => {
    expect(answerPresentation(question).requestedLanguage).toBe(language);
  });
  it.each(["Answer in German.", "日本語で回答してください。", "한국어로 답변해 주세요.", "हिंदी में उत्तर दें।", "Jawab dalam bahasa Indonesia."])(
    "clears earlier native intent on a later unsupported explicit request: %s", question => {
      expect(answerPresentation(`${question} Answer in Italian.`)).toEqual({ language: "en" });
      expect(answerPresentation(`${question} Write exactly twenty words.`).requestedMaximumWords).toBeUndefined();
    });
  it.each([["de", "German"], ["ja", "Japanese"], ["ko", "Korean"], ["hi", "Hindi"], ["id", "Indonesian"]] as const)(
    "keeps a later Then/Now directive for %s above an earlier English request", (language, name) => {
      for (const wrapper of ["Then", "Now please"]) {
        const question = `Write in English. ${wrapper} reply in ${name}.`;
        expect(answerPresentation(question)).toEqual({ language, requestedLanguage: language });
        expect(presentationStatementGuidance(answerPresentation(question))).toContain(`write each statement in ${name}`);
      }
    });
});

class SyntheticNativeEngine extends JsonChatEngine {
  readonly name = "synthetic-native-independent-review";
  readonly packets: { system: string; data: Record<string, unknown> }[] = [];
  constructor(readonly language: AdditionalAnswerLanguage) { super(); }
  protected async chatJson(_model: string, system: string, user: string) {
    const data = JSON.parse(user); this.packets.push({ system, data });
    if (this.packets.length === 2) return { reviews: [{ index: 0, supportedFact: "The synthetic rule requires a safeguard and has an exception.",
      support: 0.9, statementSupport: 0.9, statementLanguage: this.language }] };
    const option = (data.quoteOptions as { quoteId: string; marker: string }[])[0];
    return { evidence: [{ claimIndex: 0, marker: option.marker, quoteId: option.quoteId, support: 0.9,
      statement: nativeSentences[this.language] }], conflicts: [] };
  }
}

describe.each(["de", "ja", "ko", "hi", "id", "ru"] as const)("actual %s generation and independent language observation", language => {
  const question = { de: "Antworte bitte auf Deutsch.", ja: "日本語で回答してください。", ko: "한국어로 답변해 주세요.",
    hi: "कृपया हिंदी में उत्तर दें।", id: "Tolong jawab dalam bahasa Indonesia.", ru: "Ответьте по-русски." }[language];
  it("uses the existing bounded two-call generation/review path and delivers exact original pairs", async () => {
    const built = nativeFixture(language), engine = new SyntheticNativeEngine(language), presentation = answerPresentation(question);
    const input: SynthInput = { question, subClaims: [built.target], gathered: [{ sourceId: "native-copy-synthetic", sourceName: "Original source",
      sourceKind: "public-reference", marker: "S1", text: built.quote }], generationFormat: "evidence-only", observeAnswerLanguage: true, answerPresentation: presentation };
    const result = await engine.synthesize(input);
    expect(engine.packets).toHaveLength(2);
    expect(engine.packets[0].system).toContain(presentationStatementGuidance(presentation));
    expect(engine.packets[1].system).toContain("a requested language or prompt does not prove the output language");
    expect(engine.packets[1].system).toContain("Shared Han characters do not establish Japanese or Simplified Chinese");
    expect(engine.packets[1].data.schema).toContain('"de"|"ja"|"ko"|"hi"|"id"|"ru"|"UNKNOWN"');
    expect(reviewedStatementLanguage(result.evidence[0])).toBe(language);
    const statements = selectCitedStatements(languageReviewedProposals(result.evidence, language), built.ledger);
    expect(statements).toHaveLength(1); expect(statements[0].text).toBe(nativeSentences[language]);
    const answer = finalizeGroundedAnswer({ question, answer: result.answer, ledger: built.ledger, statements, presentation });
    expect(answer).toContain(nativeSentences[language]); expect(answer).toContain(built.quote);
    const packet = finalizeAnswerLanguage({ answer, rendererLanguage: language, statements, proposals: result.evidence })!;
    expect(packet.language).toBe(language);
    const run = { id: `native-${language}`, answer, trace: [{ phase: "done" as const, ts: 0, message: "Synthetic independent review", detail: { answerLanguage: packet } }] };
    expect(recordedAnswerLanguage(run)).toBe(language);
    const completed = projectCompletedAnswerLanguage(run)!;
    expect(readCompletedAnswerLanguage(completed, run.id, answer)).toEqual(completed);
    expect(readCompletedAnswerLanguage(completed, "foreign-query", answer)).toBeUndefined();
    expect(readCompletedAnswerLanguage(completed, run.id, answer + " ")).toBeUndefined();
    expect(readCompletedAnswerLanguage({ ...completed, language: `${language}-XX` }, run.id, answer)).toBeUndefined();
    expect(finalizeAnswerLanguage({ answer, rendererLanguage: language, statements, proposals: structuredClone(result.evidence) })).toBeUndefined();
    result.evidence[0].statement += " Changed.";
    expect(reviewedStatementLanguage(result.evidence[0])).toBeUndefined();
  });
  it("withholds missing, mismatched, alias and fabricated observations without changing evidence admission", () => {
    const built = nativeFixture(language);
    const proposal: ProposedEvidence = { claimIndex: 0, marker: "S1", quote: built.quote, quoteSpan: { start: 0, end: built.quote.length },
      statement: nativeSentences[language], statementSupport: 0.9, support: 0.9 };
    for (const observed of [undefined, "UNKNOWN", "en", `${language}-XX`, language.toUpperCase()]) {
      const rows = applyEvidenceReview([proposal], { reviews: [{ index: 0, support: 0.9, statementSupport: 0.9, statementLanguage: observed }] }, new Set([0]), true);
      expect(languageReviewedProposals(rows, language)).toEqual([]);
      expect(selectCitedStatements(languageReviewedProposals(rows, language), built.ledger)).toEqual([]);
      expect(built.ledger.evidence[0].qualifiesForAnswer).toBe(true); expect(built.ledger.evidence[0].qualifiesForReward).toBe(false);
    }
    expect(languageReviewedProposals([{ ...proposal, statementLanguage: language } as ProposedEvidence], language)).toEqual([]);
  });
});
