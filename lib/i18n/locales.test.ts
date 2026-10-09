import { describe, expect, it } from "vitest";
import { negotiateUiLocale, normalizeUiLocale, preparedLocales, shippedUiLocales } from "./locales";

describe("prepared locale admission", () => {
  it.each([["en-US", "en"], ["vi-VN", "vi"], ["zh", "zh-Hans"], ["zh-CN", "zh-Hans"],
    ["zh-Hans-TW", "zh-Hans"], ["zh-Hant", null], ["zh-TW", null], ["en-Cyrl", null],
    ["pt", null], ["en_US", null], [" en", null], ["en-", null]])("normalizes %s without folding unsupported script", (input, expected) => {
      expect(normalizeUiLocale(input)).toBe(expected);
    });

  it("does not coerce unknown or malicious preference values", () => {
    expect(normalizeUiLocale({ toString() { throw new Error("unexpected coercion"); } })).toBeNull();
    expect(normalizeUiLocale(null)).toBeNull();
    expect(normalizeUiLocale("a".repeat(5000))).toBeNull();
  });

  it("keeps unreviewed locale preferences inactive by default", () => {
    expect(shippedUiLocales).toEqual(["en"]);
    expect(negotiateUiLocale({ explicit: "vi", stored: "zh-CN", acceptLanguage: "vi,en;q=0.2" }))
      .toEqual({ locale: "en", source: "header" });
  });

  it("respects explicit, stored, weighted header and English fallback in order", () => {
    const preferences = { explicit: "vi-VN", stored: "zh-Hans", acceptLanguage: "en" };
    expect(negotiateUiLocale(preferences, preparedLocales)).toEqual({ locale: "vi", source: "explicit" });
    expect(negotiateUiLocale({ ...preferences, explicit: "pt" }, preparedLocales)).toEqual({ locale: "zh-Hans", source: "stored" });
    expect(negotiateUiLocale({ acceptLanguage: "en;q=0.2,vi;q=0.8,zh-CN;q=0.9" }, preparedLocales))
      .toEqual({ locale: "zh-Hans", source: "header" });
    expect(negotiateUiLocale({ acceptLanguage: "fr,ja" }, preparedLocales)).toEqual({ locale: "en", source: "default" });
  });

  it("uses header order for ties and refuses malformed quality values", () => {
    expect(negotiateUiLocale({ acceptLanguage: "vi;q=0.8,en;q=0.8" }, preparedLocales).locale).toBe("vi");
    expect(negotiateUiLocale({ acceptLanguage: "vi;q=2,zh;q=NaN,en;q=0.5" }, preparedLocales).locale).toBe("en");
    expect(negotiateUiLocale({ acceptLanguage: "vi;q=0,vi-VN;q=1,zh-Hans;q=0.4" }, preparedLocales).locale).toBe("zh-Hans");
    expect(negotiateUiLocale({ acceptLanguage: "*" }, preparedLocales).source).toBe("default");
    expect(negotiateUiLocale({ acceptLanguage: "vi,".repeat(2000) }, preparedLocales).source).toBe("default");
  });

  it("requires English in any future release allowlist", () => {
    expect(() => negotiateUiLocale({}, ["vi"])).toThrow("English fallback");
  });
});
