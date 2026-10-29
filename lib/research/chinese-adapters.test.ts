import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { researchPresentationEnglish } from "../../locales/en/research-presentation";
import { researchPresentationChinese } from "../../locales/zh-Hans/research-presentation";
import { reportPresentationEnglish } from "../../locales/en/report-presentation";
import { reportPresentationChinese } from "../../locales/zh-Hans/report-presentation";
import { botResearchEnglish } from "../../locales/en/bot-research";
import { botResearchChinese } from "../../locales/zh-Hans/bot-research";
import { botControlsEnglish } from "../../locales/en/bot-controls";
import { botControlsChinese } from "../../locales/zh-Hans/bot-controls";
import { pdfReadingCopy } from "../../locales/en/pdf-reading";
import { pdfReadingChinese } from "../../locales/zh-Hans/pdf-reading";
import { clientLanguageNames, clientPresentationLanguage, clientPresentationMessages } from "../../shared/i18n/client-language";
import { systemPresentationLanguage, presentationLanguage } from "../../shared/i18n/presentation-language";
import { livePresentationLocale, recordedPresentationLocale } from "./presentation-language";
import { desktopNeutralCatalogues } from "../../shared/i18n/desktop-neutral";
import { botControlResponse, botControlsCatalogues, botPreferenceKey, type BotRecipient } from "../bots/language";
import { botAnswerPreferenceKey, botAnswerPresentation, readBotAnswerPreference } from "../bots/answer-preference";
import { readRecipientLanguage, writeRecipientLanguage } from "../notify/recipient-language";
import { citationEmailMessages } from "../notify/citation-messages";
import { buildCitationEmailContent } from "../notify/citation-email";
import { CITATION_EVENT, type CitationWebhookPayload } from "../notify/citation-webhook";
import { archiveAnswerSnippet } from "../answers-archive";
import { requestedSources } from "../web-research/requested-sources";
import { requestedSourceReport } from "../agent/requested-source-report";

const fields = (text: string) => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map(match => match[1]).sort();
describe("Chinese catalogue contracts", () => {
  it.each([
    ["research", researchPresentationEnglish, researchPresentationChinese],
    ["report", reportPresentationEnglish, reportPresentationChinese],
    ["bot-research", botResearchEnglish, botResearchChinese],
    ["bot-controls", botControlsEnglish, botControlsChinese],
    ["pdf", pdfReadingCopy, pdfReadingChinese],
  ] as const)("preserves the exact template fields in %s", (_name, english, chinese) => {
    expect(Object.keys(chinese).sort()).toEqual(Object.keys(english).sort());
    for (const [key, value] of Object.entries(english))
      expect(fields((chinese as Record<string, string>)[key])).toEqual(fields(value));
  });
  it("retains canonical financial research headings and accounting templates in English", () => {
    for (const key of ["citations", "apiAllocations", "apiTotal", "noRewards", "remoteTotal", "reportPayments"] as const)
      expect(researchPresentationChinese[key]).toBe(researchPresentationEnglish[key]);
  });
  it("changes only neutral bot wrappers; every funding, financial, settlement and pause message stays English", () => {
    const neutral = new Set(["weight", "sourcesOne", "sourcesOther", "fullTrace", "failure", "discordUsage"]);
    for (const [key, value] of Object.entries(botResearchEnglish))
      if (!neutral.has(key)) expect((botResearchChinese as Record<string, string>)[key]).toBe(value);
  });
  it("reuses exact bound PDF draft text without inferring OCR, full-document coverage or human approval", () => {
    const draft = JSON.parse(readFileSync("locales/zh-Hans/ui-drafts/pdf-reading.json", "utf8"));
    expect(draft.status).toBe("machineDraft"); expect(draft.review).toBeNull();
    const source = readFileSync(draft.sourcePath, "utf8").replace(/\r\n?/gu, "\n");
    expect(createHash("sha256").update(source).digest("hex")).toBe(draft.sourceSha256);
    for (const [key, value] of Object.entries(pdfReadingChinese)) expect(value).toBe(draft.entries[key].text);
    expect(pdfReadingChinese.textOnly).toContain("未解读图片和图表");
    expect(pdfReadingChinese.recovery).toContain("本次运行未执行 OCR");
    expect(pdfReadingChinese.limit).toContain("最后访问的页面未被完整读取");
  });
});

describe("Chinese consumer boundaries", () => {
  it.each([true, false])("reports original section qualification=%s in Chinese without promoting a bounded read", qualified => {
    const url = "https://publisher.example.invalid/original#exact-section", requested = requestedSources(`Use ${url}`);
    const [assetId, candidate] = [...requested.candidates][0];
    const input: Parameters<typeof requestedSourceReport>[0] = {
      ...requested, language: "zh-Hans", vi: false, withheld: false, decisions: [], outcomes: [],
      gathered: [{ assetId, sourceId: assetId, sourceName: candidate.name, marker: "S1", text: "Original exact text café 日本語",
        itemUrl: candidate.item!.itemUrl, webProvenance: { retrievedAt: "2026-10-29T00:00:00Z", publisherGroup: "publisher.example.invalid",
          normalizedBodyHash: "synthetic", extraction: "html", truncated: true, htmlSectionScope: {
            format: "keryx-html-section-scope-v1", fragment: "exact-section", headingLevel: 2,
            htmlStart: 42, htmlEnd: 900, documentCharacters: 1100, documentSha256: "a".repeat(64) } } }],
      evidence: [{ claimIndex: 0, claim: "Original target", marker: "S1", sourceId: assetId, sourceName: candidate.name,
        quote: "Original exact text café 日本語", support: 1, qualifiesForAnswer: qualified, qualifiesForReward: false }],
    };
    const before = JSON.stringify(input), report = requestedSourceReport(input);
    expect(report).toContain("所提供原文的状态"); expect(report).toContain(url);
    expect(report).toContain(qualified ? "保留了获准使用的摘录" : "未保留获准使用的证据");
    expect(report).toContain("提取已被截断"); expect(report).toContain("仅读取了标题章节 `#exact-section`");
    expect(report).toContain("尚未读取文档其余部分");
    const withheld = requestedSourceReport({ ...input, withheld: true });
    expect(withheld).toContain("未读取：本次运行的范围不允许访问外部文档");
    expect(withheld).not.toContain("保留了获准使用的摘录");
    expect(JSON.stringify(input)).toBe(before);
  });
  it.each(["zh", "zh-CN", "zh-SG", "zh_Hans_CN", "zh-Hans-TW"])("uses explicit or maximized Hans system script for %s labels only", system => {
    expect(systemPresentationLanguage(system)).toBe("zh-Hans");
    expect(clientPresentationLanguage(system)).toBe("zh-Hans");
    expect(clientPresentationLanguage(system, "fr")).toBe("fr");
  });
  it.each(["zh-Hant", "zh-TW", "zh-HK", "zh-MO", "zh-Hant-CN", "ja", "zh--CN"])("does not relabel %s as simplified Chinese", system => {
    expect(systemPresentationLanguage(system)).toBe(system === "ja" ? "ja" : undefined);
    expect(clientPresentationLanguage(system)).toBe(system === "ja" ? "ja" : "en");
  });
  it.each(["zh", "zh-CN", "zh-Hant", "pt-BR", "fr-FR", "ZH-HANS", { language: "zh-Hans" }])("does not treat %j aliases or hints as recorded answer evidence", value => {
    expect(recordedPresentationLocale(value)).toMatchObject({ language: "en", answerLanguage: "UNKNOWN", source: "fallback" });
    expect(livePresentationLocale({ recordedAnswerLanguage: value, requestedLanguage: "zh-Hans" }))
      .toMatchObject({ language: "zh-Hans", answerLanguage: "UNKNOWN", agreement: "UNKNOWN" });
  });
  it("exposes complete neutral client/desktop labels and preserves strict request values", () => {
    expect(clientLanguageNames["zh-Hans"]).toBe("简体中文");
    expect(clientPresentationMessages("zh-Hans").controls.answer).toBe("答案");
    expect(Object.keys(desktopNeutralCatalogues["zh-Hans"]).sort()).toEqual(Object.keys(desktopNeutralCatalogues.en).sort());
    expect(presentationLanguage("zh-Hans")).toBe("zh-Hans");
    for (const value of ["zh", "zh-CN", "zh-Hant", "ZH-HANS"]) expect(presentationLanguage(value)).toBeUndefined();
  });
  it("saves explicit bot intent only for the authenticated recipient and retains original question precedence", async () => {
    const recipient: BotRecipient = { platform: "telegram", scope: "telegram", userId: "789" };
    const state = new Map<string, string>(), store = async () => ({
      getSyncState: async (key: string) => state.get(key) ?? null,
      setSyncState: async (key: string, value: string) => { state.set(key, value); },
    });
    const result = await botControlResponse({ control: { action: "language", value: "zh-Hans" }, recipient }, store);
    expect(result.language).toBe("zh-Hans"); expect(result.text).toContain("zh-Hans");
    expect(state.get(botPreferenceKey(recipient)!)).toBe("zh-Hans");
    expect(state.get(botAnswerPreferenceKey(recipient)!)).toBe("zh-Hans");
    const question = "Original <question> café 日本語 {count}";
    expect(await botAnswerPresentation(question, recipient, store)).toEqual({ language: "zh-Hans", input: { presentationLanguage: "zh-Hans" } });
    expect(await botAnswerPresentation("请用英文回答。" + question, recipient, store)).toEqual({ language: "en", input: { presentationLanguage: "en" } });
    expect(await readBotAnswerPreference({ ...recipient, userId: "790" }, store)).toEqual({ available: true, preference: "auto" });
    expect(botControlsCatalogues["zh-Hans"].reviewBoundary).toBe(botControlsEnglish.reviewBoundary);
  });
  it("keeps source-recipient rotation separate and financial email bytes English", async () => {
    const state = new Map<string, string>(), db = { getSyncState: async (key: string) => state.get(key) ?? null,
      setSyncState: async (key: string, value: string) => { state.set(key, value); } };
    const recipient = { sourceId: "source-original", email: "creator@example.invalid", unsubToken: "a".repeat(64) };
    expect(await writeRecipientLanguage(db, recipient, "zh-Hans")).toBe(true);
    expect(await readRecipientLanguage(db, recipient)).toEqual({ language: "zh-Hans", available: true });
    for (const changed of [{ ...recipient, email: "other@example.invalid" }, { ...recipient, unsubToken: "b".repeat(64) }])
      expect(await readRecipientLanguage(db, changed)).toEqual({ language: "en", available: true });
    for (const key of ["subject", "textBody", "textRate", "htmlTitle", "htmlHeading", "htmlBody", "htmlRate"] as const)
      expect(citationEmailMessages["zh-Hans"][key]).toBe(citationEmailMessages.en[key]);
    const input: CitationWebhookPayload = { event: CITATION_EVENT, deliveryId: "synthetic", timestamp: "2026-10-29T00:00:00Z",
      source: { id: "source-original", name: 'Source <日本語> & "original"' }, query: { id: "query-original", question: "PRIVATE original question" },
      weight: 0.6, amountUsdc: 0.015, network: "arcTestnet", payments: [] };
    const before = JSON.stringify(input), options = { base: "https://example.invalid", unsubToken: "original-token" };
    const english = buildCitationEmailContent(input, { ...options, language: "en" });
    const chinese = buildCitationEmailContent(input, { ...options, language: "zh-Hans" });
    expect(chinese.subject).toBe(english.subject); expect(chinese.text.split("\n")[0]).toBe(english.text.split("\n")[0]);
    expect(chinese.text).toContain(citationEmailMessages["zh-Hans"].trace);
    expect(chinese.html).toContain("Source &lt;日本語&gt; &amp; &quot;original&quot;");
    for (const body of [chinese.text, chinese.html]) {
      expect(body).toContain("$0.015"); expect(body).toContain("https://example.invalid/dispatch/query-original");
      expect(body).not.toContain(input.query.question);
    }
    expect(JSON.stringify(input)).toBe(before);
  });
  it("skips exact current Chinese delivery leads in previews while retaining original evidence and qualification", () => {
    const original = "Literal source café 日本語 & original [S1]";
    const lead = "摘要由模型撰写，逐句附有引用。每句话均与检查时使用的来源原文配对显示。";
    const heading = "### 研究目标 1\n\n所请求的主题（未核实）：“Original target”";
    const answer = `${lead}\n\n${heading}\n\n${original}`;
    expect(archiveAnswerSnippet(answer)).toBe("Literal source café 日本語 & original");
    expect(archiveAnswerSnippet(`> ⚠ 低置信度 — 证据有限。请将此结果视为暂定结果。\n\n${answer}`))
      .toBe("⚠ 低置信度 — Literal source café 日本語 & original");
    expect(archiveAnswerSnippet(lead)).toBe(lead);
    const gap = "证据缺口：此研究目标没有获准使用的摘录。";
    expect(archiveAnswerSnippet(`${lead}\n\n${heading}\n\n${gap}`)).toBe(gap);
    expect(answer).toBe(`${lead}\n\n${heading}\n\n${original}`);
  });
});
