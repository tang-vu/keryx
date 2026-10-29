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
