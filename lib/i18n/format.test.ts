import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createFormatters, formatLocalizedDate, formatLocalizedNumber, formatLocalizedRelativeTime, formatLocalizedUsdc, formatSigningUsdc,
  formatVerifiableUsdcAmount, selectPlural, usdcDisplayMicros } from "./format";
import { preparedLocales } from "./locales";
import { formatUsdcMicros } from "../display/recorded-usdc";

describe("locale presentation preserves exact monetary authority", () => {
  it.each([["en", "1,234.000001 USDC"], ["vi", "1.234,000001 USDC"], ["zh-Hans", "1,234.000001 USDC"]] as const)(
    "formats %s by splitting integers, preserving all six fractional places", (locale, expected) => {
      expect(formatLocalizedUsdc("1234000001", locale)).toBe(expected);
      expect(formatLocalizedUsdc(BigInt(1), locale)).toBe(locale === "vi" ? "0,000001 USDC" : "0.000001 USDC");
      expect(formatLocalizedUsdc(49, locale)).toBe(locale === "vi" ? "0,000049 USDC" : "0.000049 USDC");
    });

  it("keeps the existing safe range and canonical machine formatter unchanged", () => {
    expect(formatLocalizedUsdc("9007199254740991", "vi")).toBe("9.007.199.254,740991 USDC");
    expect(formatUsdcMicros("9007199254740991", { denomination: "USDC" })).toBe("9007199254.740991 USDC");
    expect(formatSigningUsdc("1234000001")).toBe("1234.000001 USDC");
    expect(formatSigningUsdc(0)).toBe("0.000000 USDC");
    expect(formatLocalizedUsdc(1000000, "vi", 4)).toBe("1,0000 USDC");
  });

  it.each([undefined, null, "1.2", "01", "9007199254740992", -1, 0.1, NaN, -0])("refuses invalid exact micro inputs %s", input => {
    expect(formatLocalizedUsdc(input, "vi")).toBe("Amount unavailable");
    expect(formatSigningUsdc(input)).toBe("Amount unavailable");
  });

  it("uses explicit locale grouping for ordinary numbers, separate from amount authority", () => {
    expect(formatLocalizedNumber(1234.5, "vi")).toBe("1.234,5");
    expect(formatLocalizedNumber(BigInt("12345678901234567890"), "en")).toBe("12,345,678,901,234,567,890");
    expect(formatLocalizedNumber(Infinity, "en")).toBe("Unavailable");
  });
});

describe("date, clock and plural presentation", () => {
  it("uses a viewer zone explicitly and preserves exact UTC for hover/details", () => {
    const utc = "2026-10-09T00:30:00.000Z";
    const west = formatLocalizedDate(utc, "en", "America/Los_Angeles")!;
    const east = formatLocalizedDate(utc, "en", "Asia/Ho_Chi_Minh")!;
    expect(west.text).toContain("Oct 8, 2026");
    expect(east.text).toContain("Oct 9, 2026");
    expect(west.utc).toBe(utc); expect(east.utc).toBe(utc);
  });

  it.each(["2026-02-30T12:00:00Z", "2026-10-09", "nonsense"])("does not repair invalid or noninstant date %s", utc => {
    expect(formatLocalizedDate(utc, "en", "UTC")).toBeNull();
  });

  it("refuses invalid zones and uses a caller-provided relative clock", () => {
    expect(formatLocalizedDate("2026-10-09T00:30:00Z", "en", "Invalid/Zone")).toBeNull();
    expect(formatLocalizedDate("2026-10-09T00:30:00Z", "en", "")).toBeNull();
    expect(formatLocalizedRelativeTime("2026-10-09T00:30:00Z", "2026-10-09T00:32:00Z", "en")).toBe("2 minutes ago");
    expect(formatLocalizedRelativeTime("2026-10-10T00:30:00Z", "2026-10-09T00:30:00Z", "en")).toBe("tomorrow");
    expect(formatLocalizedRelativeTime("invalid", "2026-10-09T00:30:00Z", "en")).toBe("Unavailable");
  });

  it("uses locale plural rules rather than English count heuristics", () => {
    expect(selectPlural(1, "en")).toBe("one"); expect(selectPlural(2, "en")).toBe("other");
    expect(selectPlural(1, "vi")).toBe("other"); expect(selectPlural(1, "zh-Hans")).toBe("other");
    expect(() => selectPlural(NaN, "en")).toThrow("finite");
  });
});

describe("bound display formatters", () => {
  const cases = [
    [0.000001, 6, "0.000001", "0,000001", "0.000001"],
    [0.000049, 6, "0.000049", "0,000049", "0.000049"],
    [0.004, 2, "0.00", "0,00", "0.00"],
    [0.005, 2, "0.01", "0,01", "0.01"],
    [0.00005, 4, "0.0001", "0,0001", "0.0001"],
    [1234.5, 4, "1,234.5000", "1.234,5000", "1,234.5000"],
    [1234567.891234, 6, "1,234,567.891234", "1.234.567,891234", "1,234,567.891234"],
    [-0.25, 4, "-0.2500", "-0,2500", "-0.2500"],
    [-0.0000001, 6, "0.000000", "0,000000", "0.000000"],
  ] as const;

  it.each(cases)("derives %s USDC at %s places from its exact micro integer in every prepared locale", (usdc, digits, en, vi, zh) => {
    expect(preparedLocales.map(locale => createFormatters(locale).usdc(usdc, digits))).toEqual([en, vi, zh]);
  });

  it("rounds a binary-inexact decimal amount to the recorded micro value before display", () => {
    expect(usdcDisplayMicros(0.1 + 0.2)).toBe(BigInt(300000));
    expect(usdcDisplayMicros(1.005)).toBe(BigInt(1005000));
    expect(createFormatters("vi").usdc(1.005, 2)).toBe("1,01");
    expect(usdcDisplayMicros(Number.MAX_SAFE_INTEGER)).toBeNull();
    for (const invalid of [NaN, Infinity, "1", null, undefined, BigInt(1)]) expect(createFormatters("en").usdc(invalid)).toBe("Unavailable");
  });

  it("keeps verification amounts identical and ungrouped in every prepared locale", () => {
    for (const locale of preparedLocales) {
      const format = createFormatters(locale);
      expect(format.usdcVerifiable(1000)).toBe("1000.000000");
      expect(format.usdcVerifiable(1.000001)).toBe("1.000001");
      expect(format.usdcVerifiable(0.05)).toBe("0.050000");
    }
    expect(formatVerifiableUsdcAmount(1234.5, 2)).toBe("1234.50");
    expect(formatVerifiableUsdcAmount(NaN)).toBe("Unavailable");
  });

  it("trims trailing zeros without changing the amount", () => {
    expect(createFormatters("en").usdcTrimmed(0)).toBe("0");
    expect(createFormatters("en").usdcTrimmed(0.05)).toBe("0.05");
    expect(createFormatters("vi").usdcTrimmed(1234.5)).toBe("1.234,5");
    expect(createFormatters("en").usdcTrimmed(-0.0000001)).toBe("0");
    expect(createFormatters("en").usdcTrimmed(2)).toBe("2");
  });

  it("formats counts, fixed decimals and percentages by locale", () => {
    expect(createFormatters("en").number(12345)).toBe("12,345");
    expect(createFormatters("vi").number(12345)).toBe("12.345");
    expect(createFormatters("en").decimal(0.5, 2)).toBe("0.50");
    expect(createFormatters("vi").decimal(87.25, 1)).toBe("87,3");
    expect(createFormatters("en").percent(0.875, 1)).toBe("87.5%");
    expect(createFormatters("en").percent(0.5, 1)).toBe("50.0%");
    expect(createFormatters("en").percent(0.5, 1, false)).toBe("50%");
    expect(createFormatters("vi").percent(0.875, 1)).toBe("87,5%");
    expect(createFormatters("en").percent(NaN)).toBe("Unavailable");
  });

  it("formats recorded instants in an explicit zone and refuses invalid values", () => {
    const format = createFormatters("en");
    expect(format.date("2026-10-09T00:30:00.000Z", "UTC")).toBe("Oct 9, 2026");
    expect(format.date("2026-10-09T00:30:00.000Z", "America/Los_Angeles")).toBe("Oct 8, 2026");
    expect(format.date(Date.UTC(2026, 9, 9), "UTC")).toBe("Oct 9, 2026");
    expect(format.instant("2026-10-09T00:30:00.000Z", "monthDay", "UTC")).toBe("Oct 9");
    expect(format.dateTime("2026-10-09T00:30:00.000Z", "UTC")).toMatch(/^Oct 9, 2026, 12:30\sAM$/u);
    expect(format.instant("2026-10-09T00:30:05.000Z", "dateTimeSecondsZone", "UTC")).toMatch(/^Oct 9, 2026, 12:30:05\sAM UTC$/u);
    expect(createFormatters("vi").date("2026-10-09T00:30:00.000Z", "UTC")).toBe("9 thg 10, 2026");
    expect(format.date("nonsense", "UTC")).toBe("Unavailable");
    expect(format.date("2026-10-09T00:30:00.000Z", "Invalid/Zone")).toBe("Unavailable");
  });
});

describe("display formatting has one owner", () => {
  // Canvas colour channels are not user-visible text.
  const exempt = new Set(["components/keryx/ink-bleed-cursor.tsx"]);
  const adHoc = /\.toFixed\(|\.toLocale(?:Date|Time)?String\(|Intl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat|PluralRules)\b/u;
  function sources(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const file = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) return sources(file);
      // Route handlers emit machine-readable responses, which keep one fixed format.
      return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) && entry.name !== "route.ts" ? [file] : [];
    });
  }

  it("keeps ad-hoc number, amount and date formatting out of pages and components", () => {
    const offenders = ["app", "components"].flatMap(sources)
      .filter(file => !exempt.has(file) && adHoc.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
