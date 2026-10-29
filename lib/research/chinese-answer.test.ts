import { describe, expect, it } from "vitest";
import { chineseAnswerInstructions } from "./chinese-answer-intent";
import { answerPresentation, presentationStatementGuidance } from "./answer-presentation";
import { isPresentationLanguage, presentationLanguage, systemPresentationLanguage } from "../../shared/i18n/presentation-language";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AnswerMarkdown } from "../../components/keryx/answer-markdown";
import { buildEvidenceLedger } from "../agent/evidence-ledger";
import { selectCitedStatements } from "../agent/cited-statements";
import { finalizeGroundedAnswer } from "../agent/answer-grounding";
import { JsonChatEngine } from "../llm/json-chat-engine";
import { applyEvidenceReview } from "../llm/evidence-review";
import type { ProposedEvidence, SynthInput } from "../llm/reasoning-engine";
import { languageReviewedProposals, reviewedStatementLanguage } from "./answer-language-review";
import { finalizeAnswerLanguage, projectCompletedAnswerLanguage, readCompletedAnswerLanguage, recordedAnswerLanguage } from "./answer-language-provenance";
import { confidenceBanner, evidenceConfidenceReason, ordinaryConfidence } from "./confidence-copy";
import { researchFollowUp } from "../agent/research-follow-up";
import { publicReadRecoveryLines } from "../agent/read-recovery";
import { synthesisFailureDetail } from "../agent/synthesis-failure";

const last = (question: string) => chineseAnswerInstructions(question.normalize("NFC").toLowerCase())
  .filter(instruction => instruction.eligible).at(-1)?.language;

describe("additional ordinary Chinese intent grammar", () => {
  it.each([
    "请用简体中文回答。解释这项规则。", "用简体中文回答。解释这项规则。", "请用中文回答。解释这项规则。",
    "用中文回答。解释这项规则。", "以中文回答。解释这项规则。", "使用中文回答。解释这项规则。",
    "Answer in Simplified Chinese. Explain the rule.", "Answer in Chinese. Explain the rule.",
    "Please answer in Chinese. Explain the rule.", "Answer in French. 请用简体中文回答。解释这项规则。",
    "No thanks\nAnswer in Chinese. Explain the rule.",
  ])("recognizes a bounded positive directive: %s", question => { expect(last(question)).toBe("zh-Hans"); });

  it.each([
    "不要用简体中文回答。Explain the rule.", "请不要用简体中文回答。Explain the rule.",
    "别用中文回答。Explain the rule.", "请别用中文回答。Explain the rule.", "不用中文回答。Explain the rule.",
    "不必用中文回答。Explain the rule.", "无需用中文回答。Explain the rule.", "勿用中文回答。Explain the rule.",
    "Do not answer in Chinese. Explain the rule.", "Don't\nanswer in Chinese. Explain the rule.",
    "Explain the phrase “请用中文回答”.", "解释「请用中文回答」这句话。", "解释『请用中文回答』这句话。",
    "解释《请用中文回答》这个标题。", "Explain `Answer in Chinese` as an instruction.",
    "请解释日本语中的汉字。", "日本語の漢字について説明してください。", "A title says Answer in Chinese.",
  ])("does not treat negation, a quoted original or Han characters as intent: %s", question => {
    expect(last(question)).toBeUndefined();
  });

  it("records unsupported Traditional Chinese so it can clear an earlier ordinary instruction", () => {
    for (const question of ["请用繁体中文回答。解释这项规则。", "請用繁體中文回答。", "Answer in Traditional Chinese."]) {
      const instruction = chineseAnswerInstructions(question.toLowerCase()).filter(row => row.eligible).at(-1);
      expect(instruction).toBeDefined(); expect(instruction?.language).toBeUndefined();
    }
  });
  it("keeps the original span and precedence for native English or a later Chinese instruction", () => {
    const question = "请用中文回答。请用英语回答。解释这项规则。";
    expect(last(question)).toBe("en");
    expect(last("请用英语回答。请用中文回答。解释这项规则。")).toBe("zh-Hans");
    for (const instruction of chineseAnswerInstructions(question))
      expect(question.slice(instruction.index, instruction.end)).toMatch(/用(?:中文|英语)回答/u);
    expect(question).toBe("请用中文回答。请用英语回答。解释这项规则。");
  });
  it("keeps quoted and negated English spans available to exclude old partial matches", () => {
    for (const question of ["“Answer in Simplified Chinese.”", "Do not answer in Chinese."]) {
      const instructions = chineseAnswerInstructions(question.toLowerCase());
      expect(instructions).toHaveLength(1); expect(instructions[0].eligible).toBe(false);
      expect(question.slice(instructions[0].index, instructions[0].end)).toMatch(/(?:answer|Answer) in (?:Simplified )?Chinese/u);
    }
  });
});

describe("actual ordinary question authority", () => {
  it.each(["请用简体中文回答。解释这项规则。", "Answer in Chinese. Explain the rule.",
    "Answer in Simplified Chinese. Explain the rule.", "Répondez en français. 请用中文回答。解释这项规则。"])(
    "selects Chinese only from the original positive instruction: %s", question => {
      const original = question;
      const presentation = answerPresentation(question);
      expect(presentation.language).toBe("zh-Hans"); expect(presentation.requestedLanguage).toBe("zh-Hans");
      expect(presentationStatementGuidance(presentation)).toContain("Simplified Chinese");
      expect(question).toBe(original);
    });
  it.each(["Answer in French. 请用繁体中文回答。解释这项规则。", "请用中文回答。Answer in Traditional Chinese."])(
    "clears an earlier request when a later explicit language is unsupported: %s", question => {
      expect(answerPresentation(question)).toEqual({ language: "en" });
      expect(presentationStatementGuidance(answerPresentation(question))).toBe("");
    });
  it("honors the last original directive across Chinese clause punctuation", () => {
    expect(answerPresentation("请用中文回答。In English, explain the rule.").requestedLanguage).toBe("en");
    expect(answerPresentation("请用中文回答。Répondez en français. Explain the rule.").requestedLanguage).toBe("fr");
    expect(answerPresentation("请用中文回答。请用英语回答。解释这项规则。").requestedLanguage).toBe("en");
    expect(answerPresentation("请用中文回答。不要用英语回答。解释这项规则。").requestedLanguage).toBe("zh-Hans");
  });
  it("preserves earlier intent when a quoted or negated Chinese instruction is original data", () => {
    for (const text of ["Answer in French. Explain “Answer in Chinese.”", "Répondez en français. 不要用中文回答。解释这项规则。"])
      expect(answerPresentation(text).requestedLanguage).toBe("fr");
  });
  it("does not enroll legacy/retained producers or English-only word projection", () => {
    for (const scope of ["legacy", "retained"] as const) {
      expect(answerPresentation("请用中文回答。解释这项规则。", scope)).toEqual({ language: "en" });
      expect(answerPresentation("Answer in Chinese. Explain the rule.", scope)).toEqual({ language: "en" });
    }
    expect(answerPresentation("请用中文回答。Write exactly twenty words explaining the rule.").requestedMaximumWords).toBeUndefined();
  });
  it.each(["zh", "zh-CN", "zh-SG", "zh-Hans", "zh-Hans-CN", "zh_Hans_HK"])("negotiates Hans system labels without giving aliases output authority: %s", locale => {
    expect(systemPresentationLanguage(locale)).toBe("zh-Hans");
    expect(isPresentationLanguage(locale)).toBe(locale === "zh-Hans");
    expect(presentationLanguage(locale)).toBe(locale === "zh-Hans" ? "zh-Hans" : undefined);
  });
  it.each(["zh-TW", "zh-HK", "zh-MO", "zh-Hant", "zh-Hant-CN", "ja-JP", "zh-invalid-@@"])(
    "keeps other scripts and malformed locales separate from Hans: %s", locale => {
      expect(systemPresentationLanguage(locale)).toBe(locale === "ja-JP" ? "ja" : undefined);
      expect(presentationLanguage(locale)).toBeUndefined();
    });
});

const target = "Original target <scope> {count} 日本語";
const quote = "The synthetic policy requires one documented safeguard, with a stated exception.";
const statement = "该合成规则要求一项有记录的保障措施，并规定了一项例外。";
const source = { sourceId: "synthetic-chinese", sourceName: "Original source <literal> 日本語", marker: "S1",
  sourceKind: "public-reference" as const, text: quote };
const proposal: ProposedEvidence = { claimIndex: 0, marker: "S1", quote,
  quoteSpan: { start: 0, end: quote.length }, support: 0.9, statement, statementSupport: 0.9 };

it("reports observed Chinese PDF scope and bounded recovery without changing retained inputs or permitting a new payment", () => {
  const scope = { format: "keryx-pdf-text-scope-v1" as const, pagesRead: 3, totalPages: 5, pagesWithoutText: [2], textLimitReached: false };
  const input = { vi: false, language: "zh-Hans" as const, outcomes: [{ name: "Original PDF", code: "pdf-extraction-unavailable" }],
    gathered: [{ ...source, webProvenance: { retrievedAt: "2026-10-29T00:00:00Z", publisherGroup: "synthetic.example",
      normalizedBodyHash: "synthetic", extraction: "pdf" as const, truncated: true, pdfTextScope: scope } }], conflicts: [], paymentReviewRequired: true };
  const before = JSON.stringify(input), followUp = researchFollowUp(input);
  expect(followUp).toContain("后续步骤");
  expect(followUp).toContain("3"); expect(followUp).toContain("5");
  expect(followUp).toContain("未执行 OCR");
  expect(followUp).toContain("Before any new paid attempt, inspect this job's original payment receipts");
  expect(JSON.stringify(input)).toBe(before);
  const outcomes = Array.from({ length: 11 }, (_, index) => ({ name: `Original${index}`, code: "unknown-new-code" }));
  const rows = publicReadRecoveryLines([...outcomes, outcomes[0]], false, false, true);
  expect(rows).toHaveLength(9); expect(rows.at(-1)).toContain("另有 3 次读取失败");
  expect(rows[0]).toContain("此失败不能证明文档不存在");
  for (const stage of ["input", "generation", "review", "synthesis"] as const) {
    expect(synthesisFailureDetail(stage, 1, false, false, true)).toContain("不能证明文档缺乏证据");
    expect(synthesisFailureDetail(stage, 1, false, false, true)).toContain("before any new paid request");
    expect(synthesisFailureDetail(stage, 0, false, false, true)).toBe("");
  }
});
function reviewed(language: unknown) {
  return applyEvidenceReview([proposal], { reviews: [{ index: 0, support: 0.9, statementSupport: 0.9, statementLanguage: language }] }, new Set([0]), true);
}
function fixture(rows = reviewed("zh-Hans"), coverage = 0.9, extraTargets: string[] = [], unavailable = false) {
  const targets = [target, ...extraTargets];
  const ledger = buildEvidenceLedger({ subClaims: targets, gathered: [source], answer: "Unreviewed draft [S1]",
    declaredMarkers: ["S1"], proposedEvidence: rows, finalAssessment: targets.map(claim => ({ claim, coverage, coveredBy: ["S1"] })) });
  const statements = selectCitedStatements(languageReviewedProposals(rows, "zh-Hans"), ledger);
  const answer = finalizeGroundedAnswer({ question: "请用简体中文回答。解释这项规则。", answer: "Unreviewed draft [S1]",
    ledger, statements, synthesisUnavailable: unavailable, presentation: { language: "zh-Hans", requestedLanguage: "zh-Hans" } });
  return { ledger, statements, answer, rows };
}
class SyntheticChineseEngine extends JsonChatEngine {
  readonly name = "synthetic-chinese-independent-review";
  packets: { system: string; data: Record<string, unknown> }[] = [];
  protected async chatJson(_model: string, system: string, user: string) {
    const data = JSON.parse(user); this.packets.push({ system, data });
    if (this.packets.length === 2) return { reviews: [{ index: 0, supportedFact: "The policy has a safeguard and an exception.",
      support: 0.9, statementSupport: 0.9, statementLanguage: "zh-Hans" }] };
    const option = (data.quoteOptions as { quoteId: string; marker: string }[])[0];
    return { evidence: [{ claimIndex: 0, marker: option.marker, quoteId: option.quoteId, support: 0.9, statement }], conflicts: [] };
  }
}

describe("actual reviewed Chinese sentence and renderer boundaries", () => {
  it("guides generation before the same bounded independent review and preserves exact originals", async () => {
    const input: SynthInput = { question: "请用简体中文回答。解释这项规则。", subClaims: [target], gathered: [source],
      generationFormat: "evidence-only", observeAnswerLanguage: true, answerPresentation: { language: "zh-Hans", requestedLanguage: "zh-Hans" } };
    const engine = new SyntheticChineseEngine(), result = await engine.synthesize(input);
    expect(engine.packets).toHaveLength(2);
    expect(engine.packets[0].system).toContain("write each statement in Simplified Chinese");
    expect(engine.packets[1].system).toContain("a requested language or prompt does not prove");
    expect(engine.packets[1].system).toContain("Traditional Chinese, mixed, unsupported or ambiguous language is UNKNOWN");
    expect(engine.packets[1].data.schema).toContain('"zh-Hans"|"de"|"ja"|"ko"|"hi"|"id"|"UNKNOWN"');
    expect(reviewedStatementLanguage(result.evidence[0])).toBe("zh-Hans");
    const built = fixture(result.evidence);
    expect(built.answer).toContain(statement); expect(built.answer).toContain(`来源原文：“${quote}”`);
    expect(built.answer).toContain(target); expect(built.answer).not.toContain("Unreviewed draft");
    expect(built.ledger.evidence[0].quote).toBe(quote);
  });
  it.each([undefined, "UNKNOWN", "en", "zh", "zh-CN", "zh-Hant", "zh-Hans-CN", "ja"])(
    "withholds a nonmatching %s observation while preserving admitted evidence", observation => {
      const built = fixture(reviewed(observation));
      expect(built.statements).toEqual([]); expect(built.answer).not.toContain(statement);
      expect(built.answer).toContain(quote); expect(built.answer).toContain("仅提供来源摘录");
      expect(built.ledger.evidence[0].quote).toBe(quote); expect(built.ledger.acceptedMarkers.has("S1")).toBe(true);
    });
  it("binds final prose to exact bytes/query and withholds alias, clone and mutated observations", () => {
    const built = fixture(), packet = finalizeAnswerLanguage({ ...built, rendererLanguage: "zh-Hans", proposals: built.rows })!;
    expect(packet.language).toBe("zh-Hans");
    const run = { id: "chinese-original-query", answer: built.answer, trace: [{ phase: "done" as const, ts: 0, message: "Synthetic review", detail: { answerLanguage: packet } }] };
    expect(recordedAnswerLanguage(run)).toBe("zh-Hans");
    const completed = projectCompletedAnswerLanguage(run)!;
    expect(readCompletedAnswerLanguage(completed, run.id, run.answer)).toEqual(completed);
    expect(readCompletedAnswerLanguage(completed, "foreign", run.answer)).toBeUndefined();
    expect(readCompletedAnswerLanguage(completed, run.id, run.answer + " ")).toBeUndefined();
    for (const language of ["zh", "zh-CN", "zh-Hans-CN", "zh-Hant"])
      expect(readCompletedAnswerLanguage({ ...completed, language }, run.id, run.answer)).toBeUndefined();
    expect(finalizeAnswerLanguage({ ...built, rendererLanguage: "zh-Hans", proposals: structuredClone(built.rows) })).toBeUndefined();
    const html = renderToStaticMarkup(createElement(AnswerMarkdown, { text: built.answer, citations: [], language: packet.language }));
    expect(html).toContain('lang="zh-Hans"'); expect(html).toContain(`<span lang="und">“${quote}”</span>`);
    built.rows[0].statement += " Changed."; expect(reviewedStatementLanguage(built.rows[0])).toBeUndefined();
  });
  it("keeps evidence gaps, unavailable assessment and confidence limitations in native copy", () => {
    const gap = fixture(reviewed("zh-Hans"), 0.5, ["Original missing target"]);
    expect(gap.answer).toContain("证据缺口"); expect(gap.answer).toContain("Original missing target");
    const unavailable = fixture([], 0, [], true);
    expect(unavailable.answer).toContain("综合或证据检查未能完成");
    expect(unavailable.answer).toContain("原始阅读结果和凭证均已保留");
    for (const delivery of ["excerpts", "unavailable"] as const)
      expect(ordinaryConfidence("zh-Hans", delivery, "原始评估", { level: "High", reason: "不能提升此结果" }).level).toBe("Low");
    const confidence = ordinaryConfidence("zh-Hans", "excerpts", "原始评估");
    const banner = confidenceBanner(unavailable.answer, confidence, "zh-Hans");
    expect(banner).toContain("低置信度"); expect(banner).toContain("请将此结果视为暂定结果"); expect(banner).not.toContain("。.");
    expect(evidenceConfidenceReason("zh-Hans", { kind: "unresolved-conflict", count: 2 })).toContain("2 项来源分歧未解决");
  });
  it("compacts only complete bindings and refuses a requested count that would lose a target or excerpt", () => {
    const built = fixture();
    const render = (requestedBulletCount: number) => finalizeGroundedAnswer({ ...built, question: "请用简体中文回答。",
      answer: "Unreviewed draft", presentation: { language: "zh-Hans", requestedLanguage: "zh-Hans", requestedBulletCount } });
    expect(render(1)).toContain(`来源原文: “${quote}”`); expect(render(1).match(/^- /gmu)).toHaveLength(1);
    expect(render(2)).toContain("无法在保留每项研究目标和所有获准摘录的同时");
    expect(render(2)).toContain(quote); expect(render(2)).toContain(statement); expect(render(2)).toContain(target);
  });
});
