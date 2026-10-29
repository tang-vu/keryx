import { describe, expect, it } from "vitest";
import { researchPresentationEnglish } from "../../locales/en/research-presentation";
import { reportPresentationEnglish } from "../../locales/en/report-presentation";
import { botResearchEnglish } from "../../locales/en/bot-research";
import { botControlsEnglish } from "../../locales/en/bot-controls";
import { pdfReadingCopy } from "../../locales/en/pdf-reading";
import { researchPresentationGerman } from "../../locales/de/research-presentation";
import { researchPresentationJapanese } from "../../locales/ja/research-presentation";
import { researchPresentationKorean } from "../../locales/ko/research-presentation";
import { researchPresentationHindi } from "../../locales/hi/research-presentation";
import { researchPresentationIndonesian } from "../../locales/id/research-presentation";
import { reportPresentationGerman } from "../../locales/de/report-presentation";
import { reportPresentationJapanese } from "../../locales/ja/report-presentation";
import { reportPresentationKorean } from "../../locales/ko/report-presentation";
import { reportPresentationHindi } from "../../locales/hi/report-presentation";
import { reportPresentationIndonesian } from "../../locales/id/report-presentation";
import { botResearchGerman } from "../../locales/de/bot-research";
import { botResearchJapanese } from "../../locales/ja/bot-research";
import { botResearchKorean } from "../../locales/ko/bot-research";
import { botResearchHindi } from "../../locales/hi/bot-research";
import { botResearchIndonesian } from "../../locales/id/bot-research";
import { botControlsGerman } from "../../locales/de/bot-controls";
import { botControlsJapanese } from "../../locales/ja/bot-controls";
import { botControlsKorean } from "../../locales/ko/bot-controls";
import { botControlsHindi } from "../../locales/hi/bot-controls";
import { botControlsIndonesian } from "../../locales/id/bot-controls";
import { pdfReadingGerman } from "../../locales/de/pdf-reading";
import { pdfReadingJapanese } from "../../locales/ja/pdf-reading";
import { pdfReadingKorean } from "../../locales/ko/pdf-reading";
import { pdfReadingHindi } from "../../locales/hi/pdf-reading";
import { pdfReadingIndonesian } from "../../locales/id/pdf-reading";
import { nativePdfReadingCopy, nativeRecoveryCopy, nativeRecoveryFormat } from "./native-recovery-copy";
import type { AdditionalAnswerLanguage } from "./native-answer-intent";
import type { PresentationLanguage } from "../../shared/i18n/presentation-language";
import type { GatheredContent } from "../llm/reasoning-engine";
import type { Decision, EvidenceRecord } from "../types";
import { publicReadRecoveryLines } from "../agent/read-recovery";
import { researchFollowUp } from "../agent/research-follow-up";
import { synthesisFailureDetail } from "../agent/synthesis-failure";
import { requestedSourceReport } from "../agent/requested-source-report";
import { requestedSources } from "../web-research/requested-sources";
import { emptyEvidenceAnswer, emptyPublicEvidenceDetail } from "../agent/empty-public-evidence";

const fields = (text: string) => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map(match => match[1]).sort();
const financialResearch = ["citations", "apiAllocations", "apiTotal", "noRewards", "remoteTotal", "reportPayments"] as const;
const neutralBot = ["weight", "sourcesOne", "sourcesOther", "fullTrace", "failure", "discordUsage"] as const;
const englishControl = ["reviewBoundary", "languageHelp", "languageInvalid"] as const;

describe.each([
  ["de", researchPresentationGerman, reportPresentationGerman, botResearchGerman, botControlsGerman, pdfReadingGerman],
  ["ja", researchPresentationJapanese, reportPresentationJapanese, botResearchJapanese, botControlsJapanese, pdfReadingJapanese],
  ["ko", researchPresentationKorean, reportPresentationKorean, botResearchKorean, botControlsKorean, pdfReadingKorean],
  ["hi", researchPresentationHindi, reportPresentationHindi, botResearchHindi, botControlsHindi, pdfReadingHindi],
  ["id", researchPresentationIndonesian, reportPresentationIndonesian, botResearchIndonesian, botControlsIndonesian, pdfReadingIndonesian],
] as const)("prepared %s consumer catalogues", (_locale, research, report, bot, controls, pdf) => {
  it.each([
    ["research", research, researchPresentationEnglish], ["report", report, reportPresentationEnglish],
    ["bot", bot, botResearchEnglish], ["controls", controls, botControlsEnglish], ["PDF", pdf, pdfReadingCopy],
  ] as const)("preserves every %s key and original-value placeholder", (_name, translated, english) => {
    expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
    expect(Object.isFrozen(translated)).toBe(true);
    for (const [key, value] of Object.entries(english)) {
      const text = (translated as Record<string, string>)[key];
      expect(typeof text).toBe("string"); expect(text.trim()).not.toBe("");
      expect(fields(text)).toEqual(fields(value));
    }
  });
  it("preserves the canonical English reward, funding, settlement, pause and review boundaries", () => {
    for (const key of financialResearch) expect(research[key]).toBe(researchPresentationEnglish[key]);
    for (const key of Object.keys(botResearchEnglish) as (keyof typeof botResearchEnglish)[])
      if (!(neutralBot as readonly string[]).includes(key)) expect(bot[key]).toBe(botResearchEnglish[key]);
    for (const key of englishControl) expect(controls[key]).toBe(botControlsEnglish[key]);
  });
  it("provides native gap, provenance and unknown-language notices rather than a success claim", () => {
    for (const key of ["evidence", "requestedUnknown", "requestedMismatch", "recordedUnknown", "unsupported", "reportEvidenceNotice"] as const)
      expect(research[key]).not.toBe(researchPresentationEnglish[key]);
    for (const key of ["target", "coverage", "documentVersion", "provenance", "scope", "scholarly"] as const)
      expect(report[key]).not.toBe(reportPresentationEnglish[key]);
    expect(controls.languageUnavailable).not.toBe(botControlsEnglish.languageUnavailable);
  });
});

// Prepared consumers only; remove this fixture cast when ordinary production
// enrollment and independent observation are complete for all five languages.
const preparedLanguage = (locale: AdditionalAnswerLanguage) => locale as unknown as PresentationLanguage;
const original = "https://developer.mozilla.org/en-US/docs/Web/API/AbortController#examples";
function originalInput() {
  const requested = requestedSources(`Use ${original}`);
  return { candidates: requested.candidates, notices: requested.notices, decisions: [] as Decision[],
    gathered: [] as GatheredContent[], evidence: [] as EvidenceRecord[], outcomes: [], vi: false, withheld: false };
}
function originalRead(qualified = true) {
  const value = originalInput(), [id, candidate] = [...value.candidates][0];
  value.gathered.push({ assetId: id, sourceId: id, sourceName: candidate.name, marker: "S1", text: "Exact original source bytes.",
    itemUrl: candidate.item!.itemUrl, webProvenance: { retrievedAt: "2026-10-29T00:00:00Z", publisherGroup: "developer.mozilla.org",
      normalizedBodyHash: "synthetic-native-recovery", extraction: "html", truncated: true } });
  value.evidence.push({ claimIndex: 0, claim: "Original target", marker: "S1", sourceId: id, sourceName: candidate.name,
    quote: value.gathered[0].text, support: 0.9, qualifiesForAnswer: qualified, qualifiesForReward: false });
  return value;
}

describe.each(["de", "ja", "ko", "hi", "id"] as const)("prepared %s observed read and recovery boundaries", locale => {
  const language = preparedLanguage(locale), copy = nativeRecoveryCopy(locale)!, pdf = nativePdfReadingCopy(locale)!;
  it("provides every bounded operational category without translating machine failure codes", () => {
    expect(Object.keys(copy.readFailure).sort()).toEqual(["publisher-verification-required", "pdf-extraction-unavailable",
      "html-extraction-unavailable", "article-byte-limit", "document-identity-changed", "empty-or-duplicate-body",
      "web-operation-limit", "invalid-url", "cancelled"].sort());
    for (const [code, text] of Object.entries(copy.readFailure)) {
      const rows = publicReadRecoveryLines([{ name: "Original name", code }], false, false, false, language);
      expect(rows).toEqual([`- “Original name”: ${text}`]);
    }
    for (const code of ["SECRET_SUPPLIER_DETAILS", "constructor", "toString", "__proto__"])
      expect(publicReadRecoveryLines([{ name: "Original name", code }], false, false, false, language)).toEqual([`- “Original name”: ${copy.unknownFailure}`]);
    expect(copy.readFailure["pdf-extraction-unavailable"]).toContain("OCR");
  });
  it("keeps sanitized names, deterministic deduplication and the eight-row bound", () => {
    const outcomes = Array.from({ length: 11 }, (_, index) => ({ name: `Original ${index}`, code: "unknown-code" }));
    const input = [...outcomes, outcomes[0]], before = structuredClone(input);
    const rows = publicReadRecoveryLines(input, false, false, false, language);
    expect(rows).toHaveLength(9); expect(rows.at(-1)).toBe(`- ${nativeRecoveryFormat(copy.additionalFailures, { count: 3 })}`);
    expect(input).toEqual(before);
    const sanitized = publicReadRecoveryLines([{ name: "# Fake\n[S99] <script>\u0000 _title_", code: "unknown-code" }], false, false, false, language).join(" ");
    expect(sanitized).not.toMatch(/\[S99\]|<script>|\u0000|_title_|unknown-code/u);
    expect(publicReadRecoveryLines([{ name: "\u0000\u202e", code: "unknown-code" }], false, false, false, language)[0]).toContain(copy.publicSource);
  });
  it("separates each failed synthesis stage from absent document evidence and keeps the paid-retry boundary English", () => {
    for (const stage of ["input", "generation", "review", "synthesis"] as const) {
      const detail = synthesisFailureDetail(stage, 2, false, false, false, language);
      expect(detail).toContain(nativeRecoveryFormat(copy.synthesisSummary, { reads: 2, reason: copy.synthesis[stage] }));
      expect(detail).toContain("Retain this job's original reads and receipts for delivery review before any new paid request.");
    }
    for (const count of [0, -1, NaN, Infinity, 0.5]) expect(synthesisFailureDetail("review", count, false, false, false, language)).toBe("");
    for (const stage of [undefined, "SECRET_ERROR", "constructor"])
      expect(synthesisFailureDetail(stage as never, 1, false, false, false, language)).toBe("");
  });
  it("shows observed PDF scope and payment-review priority without changing the original or claiming OCR", () => {
    const scope = { format: "keryx-pdf-text-scope-v1" as const, pagesRead: 3, totalPages: 5, pagesWithoutText: [2], textLimitReached: false };
    const gathered: GatheredContent[] = [{ sourceId: "original", sourceName: "Original PDF", marker: "S1", text: "Exact original text.",
      webProvenance: { retrievedAt: "2026-10-29T00:00:00Z", publisherGroup: "example.org", normalizedBodyHash: "synthetic",
        extraction: "pdf", truncated: true, pdfTextScope: scope } }];
    const input = { vi: true, language, outcomes: [], gathered, conflicts: [], paymentReviewRequired: true, synthesisFailure: "review" as const };
    const before = structuredClone(input), answer = researchFollowUp(input);
    expect(answer).toContain(copy.followUp.title); expect(answer).toContain(copy.followUp.notice);
    expect(answer).toContain(nativeRecoveryFormat(pdf.summary, { read: 3, total: 5 }));
    expect(answer).toContain(nativeRecoveryFormat(pdf.emptyPages, { pages: "2" }));
    expect(answer).toContain(pdf.limit); expect(answer).toContain(pdf.textOnly); expect(answer).toContain(pdf.recovery);
    expect(answer).not.toContain(copy.followUp.truncated);
    const payment = "Before any new paid attempt, inspect this job's original payment receipts and records; resolve pending or unknown outcomes before buying again.";
    expect(answer).toContain(payment); expect(answer.indexOf(payment)).toBeLessThan(answer.indexOf(copy.synthesis.review));
    expect(answer).not.toContain("[S1]"); expect(input).toEqual(before);
    expect(researchFollowUp({ vi: false, language, outcomes: [], gathered: [], conflicts: [] })).toBe("");
  });
  it("separates scholarly and supplied abstracts, truncation and unverified source disagreement", () => {
    const data = originalRead(), first = data.gathered[0];
    const abstract: GatheredContent = { ...first, marker: "S2", sourceId: "second", publicDeliveryKind: "abstract" };
    const conflicts = [{ point: "Unverified claim", positions: [{ marker: "S1", stance: "First" }, { marker: "S2", stance: "Second" }], trusted: "S1", reason: "Unverified preference" }];
    const answer = researchFollowUp({ vi: false, language, outcomes: [], gathered: [first, abstract], conflicts });
    expect(answer).toContain(copy.followUp.truncated); expect(answer).toContain(copy.followUp.abstract); expect(answer).toContain(copy.followUp.conflict);
    expect(answer).not.toContain("Unverified claim"); expect(answer).not.toContain("Unverified preference");
    const unknown = researchFollowUp({ vi: false, language, outcomes: [], gathered: [first], conflicts });
    expect(unknown).not.toContain(copy.followUp.conflict);
    const scholarly: GatheredContent = { ...abstract, scholarly: { provider: "arxiv", recordUrl: "https://arxiv.org/abs/2601.00001v2",
      retrievedAt: "2026-10-29T00:00:00Z", title: "Synthetic original", authors: [], workType: "preprint", peerReview: "unknown", evidenceScope: "abstract-page" } };
    const scholarlyAnswer = researchFollowUp({ vi: false, language, outcomes: [], gathered: [scholarly], conflicts: [] });
    expect(scholarlyAnswer).toContain(copy.followUp.scholarlyAbstract); expect(scholarlyAnswer).not.toContain(copy.followUp.abstract);
  });
  it.each([true, false])("reports observed original qualification=%s without promoting evidence or changing source bytes", qualified => {
    const input = originalRead(qualified), before = structuredClone(input), answer = requestedSourceReport({ ...input, language });
    expect(answer).toContain(copy.requested.title); expect(answer).toContain(`\`${original}\``);
    expect(answer).toContain(qualified ? copy.requested.qualified : copy.requested.unqualified);
    expect(answer).toContain(copy.requested.truncated); expect(answer).toContain(copy.requested.untargetedFragment);
    expect(input).toEqual(before); expect(input.evidence[0].qualifiesForReward).toBe(false);
  });
  it("distinguishes an observed section from an unread fragment and preserves withheld scope", () => {
    const input = originalRead();
    input.gathered[0].webProvenance!.htmlSectionScope = { format: "keryx-html-section-scope-v1", fragment: "examples", headingLevel: 2,
      htmlStart: 42, htmlEnd: 900, documentCharacters: 1100, documentSha256: "a".repeat(64) };
    input.gathered[0].publicDeliveryKind = "abstract";
    const answer = requestedSourceReport({ ...input, language });
    expect(answer).toContain(nativeRecoveryFormat(copy.requested.section, { section: "`#examples`" }));
    expect(answer).toContain(copy.requested.abstract); expect(answer).not.toContain(copy.requested.untargetedFragment);
    const withheld = requestedSourceReport({ ...input, language, withheld: true });
    expect(withheld).toContain(copy.requested.withheld); expect(withheld).toContain(copy.requested.unreadFragment);
    expect(withheld).not.toContain(copy.requested.qualified); expect(withheld).not.toContain(copy.requested.abstract);
    expect(withheld).not.toContain(nativeRecoveryFormat(copy.requested.section, { section: "`#examples`" }));
    expect(requestedSourceReport({ ...originalInput(), language })).toContain(copy.requested.incomplete);
  });
  it("preserves machine SKIP, diagnostic codes and original notice bytes without inventing a read", () => {
    const input = originalInput(), [id] = input.candidates.keys();
    const failed = requestedSourceReport({ ...input, language, outcomes: [{ name: "Original", assetId: id, code: "html-extraction-unavailable" }] });
    expect(failed).toContain(nativeRecoveryFormat(copy.requested.failed, { code: "html-extraction-unavailable" }));
    input.decisions.push({ sourceId: id, sourceName: "Original", action: "SKIP", rationale: "Exact original operational reason.", expectedValue: 0, price: 0, confidence: 0, targets: [] });
    expect(requestedSourceReport({ ...input, language })).toContain("SKIP: Exact original operational reason.");
    const notice = requestedSourceReport({ ...input, language, candidates: new Map(), notices: [{ url: "https://example.org/`[S9]", reason: "Exact original diagnostic reason." }] });
    expect(notice).toContain("`https://example.org/%60[\u200bS9]`: Exact original diagnostic reason.");
    expect(requestedSourceReport({ ...input, language, candidates: new Map() })).toBe("");
  });
  it("localizes empty discovery without treating unavailability as absent evidence or requesting a URL already supplied", () => {
    const input = { question: `Use ${original}`, language, outcomes: [], skipped: [], fundingUnavailable: false,
      pendingPayments: 0, settledPayments: 0, fetchFailures: 0, discovery: { status: "unavailable" as const } };
    const answer = emptyEvidenceAnswer(input);
    expect(answer).toContain(copy.empty.prefix); expect(answer).toContain(copy.empty.noEvidence);
    expect(answer).toContain(copy.empty.discoveryUnavailable); expect(answer).toContain(copy.empty.suppliedUrls);
    expect(answer).not.toContain(copy.empty.narrow);
    expect(answer).toContain(copy.empty.limitations);
    expect(answer).toContain("A larger source budget does not resolve a free-source attention gate or extraction limit.");
    const scholarly = emptyPublicEvidenceDetail([], [], { question: "Use DOI 10.1234/exact", language });
    expect(scholarly).toContain(copy.empty.scholarly); expect(scholarly).not.toContain(copy.empty.narrow);
    expect(emptyPublicEvidenceDetail([], [], { question: "A concrete question", language })).toContain(copy.empty.narrow);
    for (const [status, key] of [["withheld", "discoveryWithheld"], ["not-configured", "discoveryUnconfigured"]] as const)
      expect(emptyEvidenceAnswer({ ...input, discovery: { status } })).toContain(copy.empty[key]);
    const counts = emptyPublicEvidenceDetail([], [], { language, discovery: { attemptedQueries: 3, succeededQueries: 2, failedQueries: 1 } });
    expect(counts).toContain(nativeRecoveryFormat(copy.empty.discoveryCounts, { attempted: 3, succeeded: 2, failed: 1 }));
    const invalid = emptyPublicEvidenceDetail([], [], { language, discovery: { attemptedQueries: -1, succeededQueries: 2, failedQueries: 1 } });
    expect(invalid).not.toContain("-1");
  });
  it("preserves canonical payment-state paragraphs and suppresses new-task recovery while settlement or funding is unresolved", () => {
    const base = { question: "Original question", outcomes: [{ name: "Image PDF", code: "pdf-extraction-unavailable" }], skipped: [],
      fundingUnavailable: false, pendingPayments: 0, settledPayments: 0, fetchFailures: 0 };
    for (const patch of [{ fundingUnavailable: true }, { pendingPayments: 1 }, { settledPayments: 1 }]) {
      const english = emptyEvidenceAnswer({ ...base, ...patch });
      const localizedInput = { ...base, ...patch, question: "Tôi cần xem nguồn và tài liệu này", language };
      const before = structuredClone(localizedInput), answer = emptyEvidenceAnswer(localizedInput);
      expect(answer).toBe(copy.empty.prefix + english.slice("No supported answer: ".length));
      expect(answer).not.toContain(copy.readFailure["pdf-extraction-unavailable"]);
      expect(answer).not.toContain(copy.empty.narrow); expect(localizedInput).toEqual(before);
    }
    const failed = emptyEvidenceAnswer({ ...base, language, fetchFailures: 1 });
    expect(failed).toContain("source reads failed and no source payment was confirmed. Review this job's payment records before starting another paid job.");
    expect(failed).toContain(copy.readFailure["pdf-extraction-unavailable"]);
  });
  it("retains bounded original diagnostics and their placeholder-like bytes in empty results", () => {
    const outcomes = Array.from({ length: 4 }, (_, index) => ({ name: `Original${index}`, code: `original-code${index}` }));
    const skipped: Decision[] = [{ sourceId: "original", sourceName: "Original name", action: "SKIP", rationale: "Original reason {status}.", expectedValue: 0, price: 0, confidence: 0, targets: [] }];
    const detail = emptyPublicEvidenceDetail(outcomes, skipped, { language });
    expect(detail).toContain("Original0 (original-code0)"); expect(detail).toContain("Original2 (original-code2)");
    expect(detail).not.toContain("Original3");
    const noReads = emptyPublicEvidenceDetail([], skipped, { language });
    expect(noReads).toContain("Original name: Original reason {status}.");
    expect(noReads).toContain(copy.empty.noOriginal);
  });
});

it("replaces native recovery parameters once and rejects missing or inherited values", () => {
  expect(nativeRecoveryFormat("Original {url}; {status}", { url: "https://example.org/{status}", status: "Exact state" }))
    .toBe("Original https://example.org/{status}; Exact state");
  expect(() => nativeRecoveryFormat("{url}", {})).toThrow("Missing native recovery parameter");
  expect(() => nativeRecoveryFormat("{constructor}", {})).toThrow("Missing native recovery parameter");
});
it.each([undefined, null, "de-DE", "ja-JP", "ko-KR", "hi-IN", "id-ID", "en", "constructor", "__proto__"])(
  "does not treat a regional alias or object key as native recovery language: %s", language => {
    expect(nativeRecoveryCopy(language)).toBeUndefined(); expect(nativePdfReadingCopy(language)).toBeUndefined();
  });
