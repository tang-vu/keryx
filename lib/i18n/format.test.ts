import { describe, expect, it } from "vitest";
import { formatLocalizedDate, formatLocalizedNumber, formatLocalizedRelativeTime, formatLocalizedUsdc, formatSigningUsdc, selectPlural } from "./format";
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
