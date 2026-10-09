import { describe, expect, it } from "vitest";
import { publicLocaleAlternates, publicReportLanguage } from "./public-metadata";
import { preparedLocales } from "./locales";

describe("public locale and report language admission", () => {
  it("preserves an existing canonical and advertises only supplied published variants", () => {
    expect(publicLocaleAlternates("/answers", { en: "/answers" })).toEqual({ canonical: "/answers", languages: {
      "x-default": "/answers", en: "/answers" } });
    expect(publicLocaleAlternates("/", { en: "/", vi: "/vi", "zh-Hans": "/zh-Hans" }, preparedLocales).languages)
      .toEqual({ "x-default": "/", en: "/", vi: "/vi", "zh-Hans": "/zh-Hans" });
  });

  it.each(["https://other.test/report", "//other.test/report", "/answers?locale=vi", "/../private", "/answers#vi", "/a%2fb"])(
    "refuses unstable or cross-origin URL %s", url => {
      expect(() => publicLocaleAlternates(url, { en: "/" })).toThrow("stable root-relative");
      expect(() => publicLocaleAlternates("/", { en: url })).toThrow("stable root-relative");
    });

  it("requires the actual English fallback rather than inventing it", () => {
    expect(() => publicLocaleAlternates("/", { vi: "/vi" })).toThrow("English public fallback");
  });

  it("refuses prepared but unshipped locale URLs by default and unpublished canonicals", () => {
    expect(() => publicLocaleAlternates("/", { en: "/", vi: "/vi" })).toThrow("disabled published locale");
    expect(() => publicLocaleAlternates("/invented", { en: "/" })).toThrow("published variant");
  });

  it("uses recorded answer language independently of a viewer's interface", () => {
    expect(publicReportLanguage({ id: "run_123", visibility: "public", contentLanguage: "vi-VN" }))
      .toEqual({ canonical: "/dispatch/run_123", contentLanguage: "vi-VN", answerAttributes: { lang: "vi-VN" },
        structuredData: { inLanguage: "vi-VN" } });
    expect(publicReportLanguage({ id: "run_123", visibility: "public", contentLanguage: "ZH-hans" })?.contentLanguage).toBe("zh-Hans");
  });

  it("keeps missing historical answer language undetermined without inferring English", () => {
    expect(publicReportLanguage({ id: "historical", visibility: "public", contentLanguage: null }))
      .toEqual({ canonical: "/dispatch/historical", contentLanguage: "und", answerAttributes: { lang: "und" }, structuredData: {} });
  });

  it.each(["private", "unlisted", "unknown"] as const)("withholds %s reports before reading metadata", visibility => {
    expect(publicReportLanguage({ id: "private/id", visibility, contentLanguage: "invalid language" })).toBeNull();
  });

  it("refuses malformed identity and language on public reports", () => {
    expect(() => publicReportLanguage({ id: "../private", visibility: "public", contentLanguage: "vi" })).toThrow("identity");
    expect(() => publicReportLanguage({ id: "public", visibility: "public", contentLanguage: "vi\nX-Header" })).toThrow("language");
  });
});
