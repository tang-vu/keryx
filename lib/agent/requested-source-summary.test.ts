import { build } from "esbuild";
import { chromium, type Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { canonicalPresentationLanguages, type PresentationLanguage } from "../../shared/i18n/presentation-language";
import { nativeRecoveryCopy } from "../research/native-recovery-copy";
import { requestedSources } from "../web-research/requested-sources";
import { requestedSourceReport } from "./requested-source-report";

const summaries: Record<PresentationLanguage, string> = {
  en: "The source supplied an abstract or summary; full-text reading has not been established.",
  vi: "Nguồn chỉ cung cấp bản tóm tắt hoặc giới thiệu; chưa xác nhận đã đọc toàn văn.",
  pt: "A fonte forneceu um resumo ou uma apresentação; a leitura do texto integral não foi confirmada.",
  es: "The source supplied an abstract or summary; full-text reading has not been established.",
  fr: "La source a fourni un résumé ou une présentation ; la lecture du texte intégral n'est pas établie.",
  "zh-Hans": "来源仅提供摘要或简介；尚未确认已阅读全文。",
  de: "Die Quelle lieferte nur eine Zusammenfassung oder Einführung; eine Volltextlektüre ist nicht belegt.",
  ja: "出典は要旨または概要のみを提供しました。全文を読んだことは確認できません。",
  ko: "출처는 초록 또는 요약만 제공했습니다. 전문을 읽었다고 확인되지 않았습니다.",
  hi: "स्रोत ने केवल सार या परिचय दिया है; पूरा पाठ पढ़े जाने की पुष्टि नहीं हुई है।",
  id: "Sumber hanya menyediakan abstrak atau ringkasan; pembacaan teks lengkap belum dipastikan.",
  ru: "Источник предоставил только аннотацию или краткое изложение; чтение полного текста не подтверждено.",
  ar: "قدم المصدر ملخصًا أو نبذة فقط؛ ولم يثبت الاطلاع على النص الكامل.",
};
const genericUrl = "https://developer.mozilla.org/en-US/docs/Web/API/AbortController#examples";
const paperUrl = "https://arxiv.org/abs/2005.11401v4";

function input(language: PresentationLanguage, scholarly = false): Parameters<typeof requestedSourceReport>[0] {
  const url = scholarly ? paperUrl : genericUrl, requested = requestedSources(`Use ${url}`);
  const [assetId, candidate] = [...requested.candidates][0];
  return { ...requested, vi: language === "vi", language, withheld: false, decisions: [], outcomes: [],
    gathered: [{ assetId, sourceId: assetId, sourceName: "Original abstract guide", marker: "S1",
      itemTitle: "Abstract interface guide", itemUrl: candidate.item!.itemUrl, publicDeliveryKind: "abstract",
      sourceKind: "public-reference", text: "Exact original text café 日本語; no whole-document claim.",
      webProvenance: { retrievedAt: "2026-11-09T00:00:00Z", publisherGroup: scholarly ? "arxiv.org" : "developer.mozilla.org",
        normalizedBodyHash: "synthetic-retained-summary", extraction: "html", truncated: true },
      ...(scholarly ? { scholarly: { provider: "arxiv" as const, recordUrl: paperUrl, arxivId: "2005.11401v4",
        retrievedAt: "2026-11-09T00:00:00Z", title: "Observed paper metadata", authors: [], workType: "preprint" as const,
        peerReview: "unknown" as const, evidenceScope: "abstract-page" as const } } : {}) }],
    evidence: [{ claimIndex: 0, claim: "Original target", marker: "S1", sourceId: assetId, sourceName: "Original",
      quote: "Exact original text café 日本語; no whole-document claim.", support: 0.8,
      qualifiesForAnswer: true, qualifiesForReward: false }],
  };
}

function scholarlyNotice(language: PresentationLanguage) {
  const native = nativeRecoveryCopy(language);
  return native?.requested.abstract.trim() ?? (language === "pt"
    ? "Apenas a página do resumo foi lida; a evidência do artigo completo não está disponível."
    : language === "fr" ? "Seule la page du résumé a été lue ; les preuves du texte intégral ne sont pas disponibles."
    : language === "zh-Hans" ? "仅读取了摘要页面；全文证据不可用。"
    : language === "vi" ? "Chỉ đọc trang tóm tắt; toàn văn bài báo chưa có."
    : "Only the abstract page was read; full-paper evidence is unavailable.");
}

it.each(canonicalPresentationLanguages)("keeps supplied-summary scope distinct from a paper abstract page in %s", language => {
  const value = input(language), before = structuredClone(value), report = requestedSourceReport(value);
  expect(report).toContain(summaries[language]);
  expect(report).not.toContain(scholarlyNotice(language));
  expect(report).toContain(`\`${genericUrl}\``);
  expect(report).not.toContain("[S1]");
  expect(value).toEqual(before);
  expect(value.evidence[0]).toMatchObject({ support: 0.8, qualifiesForAnswer: true, qualifiesForReward: false });
});

it.each(canonicalPresentationLanguages.flatMap(language => (["abstract", "excerpt"] as const).map(kind => ({ language, kind }))))(
  "retains the explicit scholarly abstract-page observation in $language with delivery $kind", ({ language, kind }) => {
    const value = input(language, true); value.gathered[0].publicDeliveryKind = kind;
    const before = structuredClone(value), report = requestedSourceReport(value);
    expect(report).toContain(scholarlyNotice(language));
    expect(report).not.toContain(summaries[language]);
    expect(report).toContain(`\`${paperUrl}\``);
    expect(value).toEqual(before);
  });

it.each(canonicalPresentationLanguages)("keeps a withheld %s source unread without publishing either scope notice", language => {
  const value = { ...input(language), withheld: true }, before = structuredClone(value), report = requestedSourceReport(value);
  expect(report).not.toContain(summaries[language]);
  expect(report).not.toContain(scholarlyNotice(language));
  expect(report).toContain(`\`${genericUrl}\``);
  expect(value).toEqual(before);
});

it.each(canonicalPresentationLanguages)("does not infer either abstract scope from an ordinary excerpt in %s", language => {
  const value = input(language); value.gathered[0].publicDeliveryKind = "excerpt";
  const before = structuredClone(value), report = requestedSourceReport(value);
  expect(report).not.toContain(summaries[language]);
  expect(report).not.toContain(scholarlyNotice(language));
  expect(value).toEqual(before);
});

let browser: Browser, bundle: string;
beforeAll(async () => {
  const inputs = canonicalPresentationLanguages.map(language => {
    const value = input(language);
    return { ...value, candidates: [...value.candidates] };
  });
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{AnswerMarkdown}from'./components/keryx/answer-markdown';
    import{requestedSourceReport}from'./lib/agent/requested-source-report';
    const data=${JSON.stringify(inputs)};
    createRoot(document.getElementById('root')).render(<>{data.map(value=><section key={value.language} data-language={value.language}>
      <AnswerMarkdown text={requestedSourceReport({...value,candidates:new Map(value.candidates)})} citations={[]} language={value.language} onCitationClick={()=>{throw Error('Unexpected citation')}}/>
    </section>)}</>);
  ` }, bundle: true, minify: true, write: false, metafile: true, platform: "browser", format: "iife", jsx: "automatic",
    define: { "process.env": JSON.stringify({ NODE_ENV: "production", NEXT_PUBLIC_KERYX_NETWORK: "arcTestnet" }) } });
  for (const suffix of ["components/keryx/answer-markdown.tsx", "lib/agent/requested-source-report.ts"])
    expect(Object.keys(result.metafile!.inputs).some(path => path.replaceAll("\\", "/").endsWith(suffix))).toBe(true);
  bundle = result.outputFiles[0].text; browser = await chromium.launch({ headless: true });
}, 30_000);
afterAll(async () => browser?.close());

it("renders all supplied-summary notices and exact URLs through the actual minified Markdown consumer", async () => {
  const context = await browser.newContext({ serviceWorkers: "block" }), calls: string[] = [], errors: string[] = [];
  try {
    await context.route("**/*", route => {
      const req = route.request(); calls.push(`${req.method()} ${req.url()}`);
      if (req.url() === "https://source-scope.test/" && req.method() === "GET")
        return route.fulfill({ contentType: "text/html", body: '<!doctype html><meta charset="utf-8"><div id="root"></div>' });
      return route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(4000); page.on("pageerror", error => errors.push(error.message));
    await page.goto("https://source-scope.test/"); await page.addScriptTag({ content: bundle });
    for (const language of canonicalPresentationLanguages) {
      const section = page.locator(`[data-language="${language}"]`);
      await expect.poll(() => section.textContent()).toContain(summaries[language]);
      expect(await section.textContent()).not.toContain(scholarlyNotice(language));
      expect(await section.locator("code").allTextContents()).toContain(genericUrl);
      expect(await section.locator("a[href]").count()).toBe(0);
    }
    expect(calls).toEqual(["GET https://source-scope.test/"]); expect(errors).toEqual([]);
  } finally { await context.unrouteAll({ behavior: "wait" }); await context.close(); }
}, 20_000);
