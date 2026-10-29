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

const fields = (text: string) => [...text.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map(match => match[1]).sort();
describe("prepared Chinese catalogue contracts", () => {
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
