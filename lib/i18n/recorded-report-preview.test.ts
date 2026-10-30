import { createHash } from "node:crypto";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PresentationLanguage } from "@/shared/i18n/presentation-language";
import type { QueryRun } from "../types";
import type { ResolvedDispatch } from "../history/read-dispatch";
import { dispatchMetadataCopy } from "./report-metadata";
import { createMessages } from "./messages";
import { shippedUiLocales } from "./locales";
import { recordedReportPreview } from "./recorded-report-preview";

type Method = "deterministic-renderer" | "reviewed-statements-and-renderer";
type ImageOptions = { width: number; height: number; fonts: unknown[]; headers: Record<string, string> };
const fixture = vi.hoisted(() => ({
  resolve: vi.fn<() => Promise<ResolvedDispatch | null>>(),
  fonts: vi.fn<(text: string) => Promise<unknown[]>>(),
  image: vi.fn<(element: ReactElement, options: ImageOptions) => void>(),
}));
vi.mock("@/lib/history/read-dispatch", () => ({ resolveDispatch: fixture.resolve }));
vi.mock("@/lib/config", () => ({ config: { profile: { testnet: false } } }));
vi.mock("@/lib/og-fonts", () => ({ publicPreviewFontFamily: "Existing local font family", publicPreviewFonts: fixture.fonts }));
vi.mock("next/og", () => ({ ImageResponse: class {
  constructor(element: ReactElement, options: ImageOptions) { fixture.image(element, options); }
} }));
import DispatchOgImage, { alt, contentType, dynamic, revalidate, size } from "../../app/dispatch/[id]/opengraph-image";

const prose = { en: "Recorded evidence.", vi: "Bằng chứng được ghi lại.", pt: "Evidência registrada.", es: "Evidencia registrada.", fr: "Preuves enregistrées.", "zh-Hans": "已记录的证据。",
  de: "Erfasste Belege.", ja: "記録された根拠です。", ko: "기록된 근거입니다.", hi: "दर्ज साक्ष्य उपलब्ध हैं।", id: "Bukti telah dicatat.", ru: "Данные источников записаны.", ar: "هذه أدلة مسجَّلة." };
const expected = {
  ar: { title: "تقرير بحث Keryx", one: "مصدر مستشهد به", other: "مصادر مستشهد بها", imageOne: "مصدر مستشهد به", serial: "سلسلة 2026 — العدد 00001" },
  ru: { title: "Отчёт Keryx", one: "источник процитирован", other: "источников процитировано", imageOne: "источник процитирован", serial: "Серия 2026 — выпуск 00001" },
  de: { title: "Keryx-Recherchebericht", one: "zitierte Quelle", other: "zitierte Quellen", imageOne: "zitierte Quelle", serial: "Serie 2026 — Ausgabe 00001" },
  ja: { title: "Keryx調査レポート", one: "件の引用出典", other: "件の引用出典", imageOne: "件の引用出典", serial: "2026年シリーズ — 第00001号" },
  ko: { title: "Keryx 조사 보고서", one: "개 출처 인용", other: "개 출처 인용", imageOne: "개 출처 인용", serial: "2026 시리즈 — 제00001호" },
  hi: { title: "Keryx शोध रिपोर्ट", one: "उद्धृत स्रोत", other: "उद्धृत स्रोत", imageOne: "उद्धृत स्रोत", serial: "2026 श्रृंखला — अंक 00001" },
  id: { title: "Laporan Keryx", one: "sumber dikutip", other: "sumber dikutip", imageOne: "sumber dikutip", serial: "Seri 2026 — No. 00001" },
  "zh-Hans": { title: "Keryx 研究报告", one: "个引用来源", other: "个引用来源", imageOne: "个引用来源", serial: "2026 系列 — 第 00001 期" },
  en: { title: "Keryx Dispatch", one: "source cited", other: "sources cited", imageOne: "sources cited", serial: "Series 2026 — No. 00001" },
  vi: { title: "Báo cáo Keryx", one: "nguồn được trích dẫn", other: "nguồn được trích dẫn", imageOne: "nguồn được trích dẫn", serial: "Loạt 2026 — Số 00001" },
  pt: { title: "Relatório Keryx", one: "fonte citada", other: "fontes citadas", imageOne: "fonte citada", serial: "Série 2026 — Nº 00001" },
  es: { title: "Informe Keryx", one: "fuente citada", other: "fuentes citadas", imageOne: "fuente citada", serial: "Serie 2026 — N.º 00001" },
  fr: { title: "Rapport Keryx", one: "source citée", other: "sources citées", imageOne: "source citée", serial: "Série 2026 — N° 00001" },
};
function packet(answer: string, language: string, method: Method = "deterministic-renderer") {
  return { format: "keryx-answer-language-v1", scope: "generated-prose", language, method,
    answerSha256: `0x${createHash("sha256").update(answer, "utf8").digest("hex")}` };
}
function terminal(value: unknown): QueryRun["trace"][number] {
  return { phase: "done", ts: 0, message: "Synthetic retained packet; no producer call", detail: { answerLanguage: value } };
}
function retained(language: PresentationLanguage = "vi", method: Method = "deterministic-renderer"): QueryRun {
  const answer = `${prose[language]} “Original source cited {question} 中文” [S1]`;
  return { id: "preview_original_277", question: "Original question 中文 {question} <evidence> — NOT language proof",
    answer, trace: [terminal(packet(answer, language, method))], createdAt: "2026-10-12T23:30:00Z",
    engine: "offline-fixture", budget: 0, totalSpent: 0.123456, totalToCreators: 0.000001,
    subClaims: [], decisions: [], citations: [{ marker: "S1", sourceId: "literal-source", sourceName: "Original source 中文",
      weight: 1, reward: 0.000001, rationale: "Synthetic original citation" }], paymentMode: "offline" };
}
const matrix = (["en", "vi", "pt", "es", "fr", "zh-Hans", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const).flatMap(language =>
  (["deterministic-renderer", "reviewed-statements-and-renderer"] as const).map(method => ({ language, method })));
const params = { params: Promise.resolve({ id: "preview_original_277" }) };
function admit(value: QueryRun, archive: ResolvedDispatch["archive"] = null) {
  fixture.resolve.mockResolvedValue({ run: value, reader: {} as ResolvedDispatch["reader"], archive, visibility: "public" });
}
const fonts = [{ name: "Existing local face", data: new Uint8Array([1]), weight: 400, style: "normal" }];
function expectGenericFontInputs(count: number) {
  expect(fixture.fonts).toHaveBeenCalledTimes(count);
  for (const [text] of fixture.fonts.mock.calls) expect(text.split("\n")).toEqual([
    "An autonomous Keryx dispatch", expect.stringMatching(/^Series 2026 — No\. \d{5}$/u), "sources cited",
  ]);
}
beforeEach(() => { vi.clearAllMocks(); fixture.fonts.mockResolvedValue(fonts); });
function lastImage() {
  const [element, options] = fixture.image.mock.calls.at(-1)!;
  return { html: renderToStaticMarkup(element), options };
}

describe("finite retained-report presentation", () => {
  it.each(matrix)("selects $language ordinary labels from $method final-byte provenance", ({ language, method }) => {
    const value = retained(language, method), before = JSON.stringify(value);
    const preview = recordedReportPreview(value);
    expect(preview.answerLanguage).toBe(language);
    expect(preview.presentationLanguage).toBe(language);
    expect(preview.title(value.question)).toBe(`${value.question} — ${expected[language].title}`);
    expect(preview.serial("00001")).toBe(expected[language].serial);
    expect(preview.citedLabel(1)).toBe(expected[language].imageOne);
    expect(preview.citedLabel(0)).toBe(expected[language].other);
    for (const historical of [false, true]) {
      for (const bibliographic of [false, true]) {
        for (const confidence of [undefined, "Moderate"]) {
          for (const count of [0, 1, 2]) {
            const input = Object.freeze({ historical, bibliographic, confidence, count, spent: "0.123456", creators: "0.000001",
              excerpt: 'Literal 1 source cited · 2 sources cited · {count} “Original” 中文' });
            const descriptions = preview.metadataCopy(input);
            const label = count === 2 && language === "ar" ? "مصدران مستشهد بهما"
              : language === "ru" && count === 2 ? "источника процитировано" : expected[language][count === 1 ? "one" : "other"];
            expect(descriptions.description).toContain(`${count} ${label} · $0.123456 spent`);
            expect(descriptions.description).toContain(input.excerpt);
            expect(descriptions.openGraph).toContain(language === "en" ? `${count} cited` : `${count} ${label}`);
            expect(descriptions.openGraph).toContain("$0.123456 spent · $0.000001 to creators");
            const prefix = `${historical ? "Arc testnet historical · " : ""}${bibliographic ? "Original bibliographic metadata · " : confidence ? "Moderate confidence · " : ""}`;
            expect(descriptions.description.startsWith(prefix)).toBe(true);
            expect(descriptions.openGraph.startsWith(prefix)).toBe(true);
            if (language === "en") expect(descriptions).toEqual(dispatchMetadataCopy(input));
          }
        }
      }
    }
    expect(JSON.stringify(value)).toBe(before);
    expect(shippedUiLocales).toEqual(["en"]);
  });

  const refused: Array<[string, (value: QueryRun) => QueryRun]> = [
    ["absent", value => ({ ...value, trace: [] })],
    ["future", value => ({ ...value, trace: [terminal({ ...packet(value.answer, "vi"), format: "keryx-answer-language-v2" })] })],
    ["conflicting", value => ({ ...value, trace: [...value.trace, terminal(packet(value.answer, "es"))] })],
    ["duplicate", value => ({ ...value, trace: [...value.trace, value.trace[0]] })],
    ["malformed", value => ({ ...value, trace: [terminal({ ...packet(value.answer, "vi"), answerSha256: "broken" })] })],
    ["unsupported language alias", value => ({ ...value, trace: [terminal(packet(value.answer, "zh-CN"))] })],
    ["unsupported traditional script", value => ({ ...value, trace: [terminal(packet(value.answer, "zh-Hant"))] })],
    ["requested alias", value => ({ ...value, trace: [terminal(packet(value.answer, "pt-BR"))] })],
    ["request-only", value => ({ ...value, trace: [{ phase: "done", ts: 0, message: "Answer in Vietnamese", detail:
      { requestedLanguage: "vi", language: "vi", answerLocale: "vi" } }] })],
    ["final-byte mismatch", value => ({ ...value, answer: `${value.answer}\nChanged final bytes.` })],
    ["null", value => ({ ...value, trace: [terminal(null)] })],
    ["nonterminal", value => ({ ...value, trace: [{ ...value.trace[0], phase: "synthesize" }] })],
  ];
  it.each(refused)("uses English/und for %s, including the actual public OG caller", async (_reason, change) => {
    const value = change(retained()), before = JSON.stringify(value);
    const preview = recordedReportPreview(value);
    expect(preview.answerLanguage).toBe("und");
    expect(preview.presentationLanguage).toBe("en");
    expect(preview.title(value.question)).toBe(`${value.question} — Keryx Dispatch`);
    expect(preview.citedLabel(1)).toBe("sources cited");
    admit(value); await DispatchOgImage(params);
    const { html } = lastImage();
    expect(html).toContain("sources cited");
    expect(html).toContain("Series 2026");
    expect(html).not.toContain("nguồn được trích dẫn");
    expect(JSON.stringify(value)).toBe(before);
  });

  it("does not consult question, receipt, request or viewer getters to select presentation", () => {
    const value = retained("pt");
    const reads = vi.fn(() => { throw Error("No language authority here"); });
    for (const key of ["question", "receipt", "requestedLanguage", "uiLocale", "cookie", "headers", "provider"]) {
      Object.defineProperty(value, key, { get: reads });
    }
    expect(recordedReportPreview(value).answerLanguage).toBe("pt");
    expect(reads).not.toHaveBeenCalled();
  });
});

describe("actual OG selection and render boundary", () => {
  it.each(matrix)("renders $language / $method labels with original data and existing fonts", async ({ language, method }) => {
    const value = retained(language, method), before = JSON.stringify(value);
    admit(value); await DispatchOgImage(params);
    const { html, options } = lastImage();
    expect(fixture.image).toHaveBeenCalledTimes(1);
    expect(fixture.fonts).toHaveBeenCalledTimes(1);
    const fontFields = fixture.fonts.mock.calls[0][0].split("\n");
    expect(fontFields).toEqual([value.question, expect.stringContaining("2026"), expected[language].imageOne]);
    expect(html).toContain(fontFields[1]);
    expect(options).toEqual({ width: 1200, height: 630, fonts, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
    expect(html).toContain("Original question 中文 {question} &lt;evidence&gt;");
    expect(html).toContain(expected[language].imageOne);
    expect(html).toContain("$0.123456"); expect(html).toContain("$0.000001");
    expect(html).toContain("USDC recorded"); expect(html).toContain("creator rewards recorded");
    expect(html).toContain("The question it was paid to answer");
    expect(html).toContain("The citation toll — creators paid every time an AI cites them");
    expect(html).toContain("Arc mainnet"); expect(html).toContain("Oct 12, 2026 UTC");
    expect(html).toContain("Existing local font family");
    expect(html).not.toContain("lang=");
    expect(JSON.stringify(value)).toBe(before);
  });

  it("retains historical-network, recorded amounts and UTC date semantics", async () => {
    const value = retained("es");
    admit(value, { network: "eip155:5042002", label: "Arc testnet", capturedAt: value.createdAt,
      sourceCommit: "synthetic-original-commit", databaseSha256: "synthetic-original-hash" });
    await DispatchOgImage(params);
    const { html } = lastImage();
    expect(html).toContain("Arc testnet archive"); expect(html).not.toContain("Arc mainnet");
    expect(html).toContain("testnet USDC recorded"); expect(html).toContain("creator rewards recorded");
    expect(html).toContain("Oct 12, 2026 UTC");
  });

  it("refuses hidden getters before provenance, receipts, question and font selection", async () => {
    const reads = vi.fn(() => { throw Error("Hidden original must not be read"); });
    const secret = retained();
    for (const key of ["answer", "trace", "question", "citations", "totalSpent", "totalToCreators", "createdAt", "receipt"]) {
      Object.defineProperty(secret, key, { get: reads });
    }
    let generic: string | undefined;
    for (const visibility of ["private", "unlisted", undefined] as const) {
      const dispatch: ResolvedDispatch = { run: secret, reader: {} as ResolvedDispatch["reader"], archive: null, visibility };
      Object.defineProperty(dispatch, "archive", { get: reads });
      fixture.resolve.mockResolvedValue(dispatch); await DispatchOgImage(params);
      const { html } = lastImage();
      generic ??= html; expect(html).toBe(generic);
    }
    fixture.resolve.mockResolvedValue(null); await DispatchOgImage(params); expect(lastImage().html).toBe(generic);
    fixture.resolve.mockRejectedValue(Error("Synthetic storage refusal")); await DispatchOgImage(params); expect(lastImage().html).toBe(generic);
    expect(reads).not.toHaveBeenCalled();
    expectGenericFontInputs(5);
    expect(generic).not.toMatch(/Original question|nguồn|answerSha256/);
  });

  it("discards a failed public projection before replacing the generic fallback", async () => {
    const value = retained("pt");
    Object.defineProperty(value, "createdAt", { get() { throw Error("Synthetic unavailable recorded date"); } });
    admit(value); await DispatchOgImage(params);
    const { html } = lastImage();
    expect(html).toContain("An autonomous Keryx dispatch");
    expect(html).toContain("sources cited");
    expect(html).not.toContain("Original question");
    expectGenericFontInputs(1);
  });

  it("awaits the existing font selector before constructing ImageResponse", async () => {
    let release!: (value: unknown[]) => void;
    fixture.fonts.mockReturnValue(new Promise(resolve => { release = resolve; }));
    admit(retained("vi"));
    const pending = DispatchOgImage(params);
    await vi.waitFor(() => expect(fixture.fonts).toHaveBeenCalledTimes(1));
    expect(fixture.image).not.toHaveBeenCalled();
    release(fonts); await pending;
    expect(lastImage().options.fonts).toBe(fonts);
    expect({ alt, contentType, dynamic, revalidate, size }).toEqual({ alt: createMessages("en")("reportSocial.alt"),
      contentType: "image/png", dynamic: "force-dynamic", revalidate: 0, size: { width: 1200, height: 630 } });
  });
});
