import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ResolvedDispatch } from "../history/read-dispatch";
import type { QueryRun, Citation } from "../types";
import { AnswerMarkdown } from "../../components/keryx/answer-markdown";
import { closedDispatchMetadata, publicDispatchMetadata } from "./report-metadata";
import { createHash } from "node:crypto";
import type { PresentationLanguage } from "@/shared/i18n/presentation-language";

const fixture = vi.hoisted(() => ({ resolve: vi.fn<() => Promise<ResolvedDispatch | null>>() }));
vi.mock("@/lib/history/read-dispatch", () => ({ resolveDispatch: fixture.resolve }));
import { generateMetadata } from "../../app/dispatch/[id]/page";
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const run = (question: string, answer: string): QueryRun => ({ id: "original_277", question, answer, createdAt: "2026-10-12T00:00:00Z",
  engine: "offline-fixture", budget: 0, totalSpent: 0, totalToCreators: 0, subClaims: [], decisions: [], citations: [], trace: [], paymentMode: "offline" });
const params = { params: Promise.resolve({ id: "original_277" }) };

describe("actual report metadata language and privacy boundaries", () => {
  it.each(["Tiếng Việt: nghiên cứu", "中文：研究问题", "Answer in Portuguese"])(
    "keeps one original canonical and UNKNOWN output language for %s", async question => {
      const original = run(question, "Literal original answer [S1] — USDC 0.000001");
      fixture.resolve.mockResolvedValue({ run: original, reader: {} as ResolvedDispatch["reader"], archive: null, visibility: "public" });
      vi.stubEnv("LANG", "vi-VN");
      const before = JSON.stringify(original), result = await generateMetadata(params);
      expect(result.alternates).toEqual({ canonical: "/dispatch/original_277", languages: {}, types: {} });
      expect(result.other).toEqual({ "DC.language": "und" });
      expect(result.title).toContain(question);
      expect(result.twitter).toMatchObject({ title: result.title, description: result.openGraph?.description });
      expect(result.openGraph).not.toHaveProperty("locale");
      expect(JSON.stringify(original)).toBe(before);
    });

  it("refuses private/unlisted/unknown metadata before touching a hidden answer and clears root inheritance", async () => {
    const secret = run("SECRET QUESTION", "SECRET ANSWER");
    Object.defineProperty(secret, "answer", { get() { throw Error("Private text must not be read"); } });
    for (const visibility of ["private", "unlisted"] as const) {
      fixture.resolve.mockResolvedValue({ run: secret, reader: {} as ResolvedDispatch["reader"], archive: null, visibility });
      expect(await generateMetadata(params)).toEqual(closedDispatchMetadata());
    }
    fixture.resolve.mockResolvedValue(null); const unknown = await generateMetadata(params);
    fixture.resolve.mockRejectedValue(Error("Fixture storage unavailable")); expect(await generateMetadata(params)).toEqual(unknown);
    expect(unknown).toMatchObject({ description: null, robots: { index: false, follow: false }, referrer: "no-referrer",
      alternates: { canonical: null, languages: {}, types: {} }, openGraph: null, twitter: null, other: {} });
    expect(JSON.stringify(unknown)).not.toMatch(/SECRET|original_277/);
  });

  it("does not advertise a locale variant or accept an unstable report identity", () => {
    const text = "Recorded {question} <evidence> 中文";
    const result = publicDispatchMetadata({ id: "original_277", title: text, description: text, openGraphDescription: text });
    expect(result.title).toBe(text); expect(result.twitter?.description).toBe(text);
    expect(() => publicDispatchMetadata({ id: "../private", title: text, description: text, openGraphDescription: text })).toThrow("identity");
  });
});

describe("recorded answer DOM language without translation", () => {
  const citation: Citation = { marker: "S1", sourceId: "source", sourceName: "Original source 中文", weight: 1, reward: 0.000001, rationale: "Evidence" };
  it.each(["Xin chào: bằng chứng giữ nguyên.", "中文证据，原文不改。", "Literal English evidence."])(
    "marks unrecorded text und while leaving the original answer and citation unchanged: %s", text => {
      const answer = text + " [S1]", before = JSON.stringify(citation);
      const html = renderToStaticMarkup(createElement(AnswerMarkdown, { text: answer, citations: [citation], onCitationClick: () => {} }));
      expect(html).toMatch(/^<div lang="und"/); expect(html).toContain(text);
      expect(html).toContain('<button lang="en"');
      expect(html).toContain('Original source 中文'); expect(html).toContain("[1]");
      expect(JSON.stringify(citation)).toBe(before); expect(answer).toBe(text + " [S1]");
    });
});

// Synthetic persisted packets only: no producer, language classifier or store.
type RecordedMethod = "deterministic-renderer" | "reviewed-statements-and-renderer";
function retainedLanguagePacket(answer: string, language: string, method: RecordedMethod = "deterministic-renderer") {
  return { format: "keryx-answer-language-v1", scope: "generated-prose", language, method,
    answerSha256: `0x${createHash("sha256").update(answer, "utf8").digest("hex")}` };
}
function retainedTerminal(packet: unknown): QueryRun["trace"][number] {
  return { phase: "done", ts: 0, message: "Synthetic recorded terminal packet", detail: { answerLanguage: packet } };
}
function retainedMetadataRun(language: PresentationLanguage, method: RecordedMethod = "deterministic-renderer") {
  const prose = { en: "Recorded evidence.", vi: "Bằng chứng được ghi lại.", pt: "Evidência registrada.", es: "Evidencia registrada.", fr: "Preuves enregistrées.", "zh-Hans": "已记录的证据。" } satisfies Record<PresentationLanguage, string>;
  const value = run("Literal original 中文 question {question}", `${prose[language]} “Original 1 source cited {excerpt}” [S1]`);
  value.trace = [retainedTerminal(retainedLanguagePacket(value.answer, language, method))];
  value.totalSpent = 0.123456; value.totalToCreators = 0.000001;
  value.confidence = { level: "High", reason: "Literal original confidence reason" };
  value.citations = [{ marker: "S1", sourceId: "source", sourceName: "Original citation 中文", weight: 1, reward: 0.000001,
    rationale: "Literal original citation rationale" }];
  return value;
}
const metadataExpected = {
  "zh-Hans": { title: "Keryx 研究报告", source: "个引用来源" },
  en: { title: "Keryx Dispatch", source: "source cited" }, vi: { title: "Báo cáo Keryx", source: "nguồn được trích dẫn" },
  pt: { title: "Relatório Keryx", source: "fonte citada" }, es: { title: "Informe Keryx", source: "fuente citada" },
  fr: { title: "Rapport Keryx", source: "source citée" },
};

describe("actual metadata caller selects bounded recorded-language presentation", () => {
  const matrix = (["en", "vi", "pt", "es", "fr", "zh-Hans"] as const).flatMap(language =>
    (["deterministic-renderer", "reviewed-statements-and-renderer"] as const).flatMap(method =>
      [false, true].map(historical => ({ language, method, historical }))));
  it.each(matrix)("renders $language / $method / historical=$historical without altering originals", async ({ language, method, historical }) => {
    const value = retainedMetadataRun(language, method);
    const archive: ResolvedDispatch["archive"] = historical ? { network: "eip155:5042002", label: "Arc testnet",
      capturedAt: value.createdAt, sourceCommit: "synthetic-original-commit", databaseSha256: "synthetic-original-hash" } : null;
    fixture.resolve.mockResolvedValue({ run: value, reader: {} as ResolvedDispatch["reader"], archive, visibility: "public" });
    const before = JSON.stringify(value), result = await generateMetadata(params);
    expect(result.title).toBe(`${value.question} — ${metadataExpected[language].title}`);
    expect(result.other).toEqual({ "DC.language": language });
    expect(result.alternates).toEqual({ canonical: "/dispatch/original_277", languages: {}, types: {} });
    expect(result.description).toContain(`1 ${metadataExpected[language].source} · $0.123456 spent`);
    expect(result.description).toContain('“Original 1 source cited {excerpt}”');
    expect(result.description).toContain("High confidence");
    expect(result.openGraph?.description).toContain("$0.123456 spent · $0.000001 to creators");
    if (historical) expect(result.description).toMatch(/^Arc testnet historical · High confidence/);
    else expect(result.description).toMatch(/^High confidence/);
    expect(result.openGraph).not.toHaveProperty("locale");
    expect(result.openGraph).not.toHaveProperty("alternateLocale");
    expect(result.openGraph).toMatchObject({ title: result.title, url: "/dispatch/original_277" });
    expect(result.twitter).toMatchObject({ title: result.title, description: result.openGraph?.description });
    expect(JSON.stringify(result)).not.toMatch(/answerSha256|\/vi\/|\/pt\/|\/es\//);
    expect(JSON.stringify(value)).toBe(before);
  });

  const refused: Array<[string, (value: QueryRun) => QueryRun]> = [
    ["missing", value => ({ ...value, trace: [] })],
    ["future", value => ({ ...value, trace: [retainedTerminal({ ...retainedLanguagePacket(value.answer, "vi"), format: "keryx-answer-language-v2" })] })],
    ["conflicting", value => ({ ...value, trace: [...value.trace, retainedTerminal(retainedLanguagePacket(value.answer, "es"))] })],
    ["duplicate", value => ({ ...value, trace: [...value.trace, value.trace[0]] })],
    ["malformed", value => ({ ...value, trace: [retainedTerminal({ ...retainedLanguagePacket(value.answer, "vi"), method: "requested-language" })] })],
    ["request-only", value => ({ ...value, trace: [{ phase: "done", ts: 0, message: "Answer in Portuguese", detail: { requestedLanguage: "pt", language: "vi" } }] })],
    ["unsupported language alias", value => ({ ...value, trace: [retainedTerminal(retainedLanguagePacket(value.answer, "zh-CN"))] })],
    ["unsupported traditional script", value => ({ ...value, trace: [retainedTerminal(retainedLanguagePacket(value.answer, "zh-Hant"))] })],
    ["final-byte mismatch", value => ({ ...value, answer: `${value.answer}\nFinal bytes changed.` })],
  ];
  it.each(refused)("keeps %s provenance und with English metadata and one original canonical", async (_reason, change) => {
    const value = change(retainedMetadataRun("vi")), before = JSON.stringify(value);
    fixture.resolve.mockResolvedValue({ run: value, reader: {} as ResolvedDispatch["reader"], archive: null, visibility: "public" });
    const result = await generateMetadata(params);
    expect(result.title).toBe(`${value.question} — Keryx Dispatch`);
    expect(result.other).toEqual({ "DC.language": "und" });
    expect(result.description).toContain("1 source cited · $0.123456 spent");
    expect(result.alternates).toEqual({ canonical: "/dispatch/original_277", languages: {}, types: {} });
    expect(result.openGraph).not.toHaveProperty("locale");
    expect(JSON.stringify(value)).toBe(before);
  });

  it.each([false, true])("preserves the bibliography role and original metadata bytes, historical=%s", async historical => {
    const value = retainedMetadataRun("vi");
    const missing = { state: "missing", reason: "read-unavailable" } as const;
    value.bibliography = { kind: "bibliography", scope: "metadata-only", originalQuestionSha256: "a".repeat(64),
      requestedFields: ["title", "firstAuthor", "identifier"], requestedAuthorCount: 1,
      record: { scope: "metadata-only", requested: { scope: "metadata-only", language: "en", target: { kind: "arxiv", id: "2401.00001v1" } },
        fields: { title: missing, firstAuthor: missing, identifier: missing, year: missing, journal: missing, doi: missing, status: missing },
        authors: [], authorCount: 0, authorsIncomplete: true, peerReview: "unknown", failure: "read-unavailable" },
      text: "Literal retained bibliographic metadata — 中文 {count}", bibliographyExports: { bibtex: { count: 0, content: "" }, ris: { count: 0, content: "" } } };
    const archive: ResolvedDispatch["archive"] = historical ? { network: "eip155:5042002", label: "Arc testnet", capturedAt: value.createdAt,
      sourceCommit: "synthetic-original-commit", databaseSha256: "synthetic-original-hash" } : null;
    fixture.resolve.mockResolvedValue({ run: value, reader: {} as ResolvedDispatch["reader"], archive, visibility: "public" });
    const before = JSON.stringify(value), result = await generateMetadata(params);
    expect(result.other).toEqual({ "DC.language": "vi" });
    expect(result.description).toContain("Original bibliographic metadata · 1 nguồn được trích dẫn");
    expect(result.description).not.toContain("High confidence");
    expect(result.openGraph?.description).toContain("Original bibliographic metadata");
    expect(result.description?.startsWith("Arc testnet historical")).toBe(historical);
    expect(JSON.stringify(value)).toBe(before);
  });

  it("closes unknown visibility before every hidden field and provenance getter", async () => {
    const secret = retainedMetadataRun("vi"), reads = vi.fn(() => { throw Error("Hidden original must remain unread"); });
    for (const key of ["answer", "question", "trace", "citations", "bibliography", "confidence", "totalSpent", "totalToCreators", "receipt"]) {
      Object.defineProperty(secret, key, { get: reads });
    }
    for (const visibility of ["private", "unlisted", undefined] as const) {
      const dispatch: ResolvedDispatch = { run: secret, reader: {} as ResolvedDispatch["reader"], archive: null, visibility };
      Object.defineProperty(dispatch, "archive", { get: reads });
      fixture.resolve.mockResolvedValue(dispatch);
      expect(await generateMetadata(params)).toEqual(closedDispatchMetadata());
    }
    expect(reads).not.toHaveBeenCalled();
  });
});
