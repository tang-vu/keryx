import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatRecordedUsdc, formatUsdcMicros, recordedUsdcMicros, sumRecordedUsdc } from "./recorded-usdc";

describe("exact recorded USDC display", () => {
  it.each([
    [0, "$0.0000"], [1, "$0.000001"], [49, "$0.000049"], [50, "$0.00005"],
    [99, "$0.000099"], [100, "$0.0001"], [9999, "$0.009999"],
    [25000, "$0.0250"], [15700, "$0.0157"], [1000001, "$1.000001"],
    [123000009, "$123.000009"],
  ])("keeps all micro-USDC digits for %s", (micros, expected) => {
    expect(formatUsdcMicros(micros, { minimumFractionDigits: 4 })).toBe(expected);
    expect(formatRecordedUsdc(micros / 1e6, { minimumFractionDigits: 4 })).toBe(expected);
  });

  it("does not let a large-dollar compact display erase known fractional micro-USDC", () => {
    expect(formatRecordedUsdc(123.000009, { minimumFractionDigits: 2 })).toBe("$123.000009");
    expect(formatRecordedUsdc(123, { minimumFractionDigits: 2 })).toBe("$123.00");
  });

  it("accepts canonical legacy decimals despite binary multiplication noise", () => {
    expect(Number.isInteger(0.0157 * 1e6)).toBe(false);
    expect(recordedUsdcMicros(0.0157)).toBe(BigInt(15700));
    expect(recordedUsdcMicros(1.000001)).toBe(BigInt(1000001));
  });

  it.each([undefined, null, "0.025", "", false, {}, NaN, Infinity, -Infinity, -0, -1,
    0.0000001, Number.MIN_VALUE, 1e300, Number.MAX_SAFE_INTEGER, 0.1 + 0.2])(
    "refuses unknown, fractional or unsafe legacy amount %s without making it zero", value => {
      expect(recordedUsdcMicros(value)).toBeNull();
      expect(formatRecordedUsdc(value)).toBe("Amount unavailable");
    },
  );

  it.each(["01", "1.0", "1e6", " 1", "+1", "-1", "9007199254740992", 1.1,
    Number.MAX_SAFE_INTEGER + 1, -0, BigInt(-1), BigInt("9007199254740992"), null])(
    "refuses malformed authoritative micro input %s", value => {
      expect(formatUsdcMicros(value)).toBe("Amount unavailable");
    },
  );

  it("formats bounded authoritative integer strings without conversion to a float", () => {
    expect(formatUsdcMicros("9007199254740991")).toBe("$9007199254.740991");
    expect(formatUsdcMicros(BigInt(1), { denomination: "USDC" })).toBe("0.000001 USDC");
    expect(formatUsdcMicros("49", { denomination: "test USDC" })).toBe("0.000049 test USDC");
  });

  it("sums known payment legs in integer micro-USDC, without rounding a bad leg", () => {
    expect(sumRecordedUsdc([0.1, 0.2])).toBe(BigInt(300000));
    expect(formatUsdcMicros(sumRecordedUsdc([0.1, 0.2]))).toBe("$0.3");
    expect(sumRecordedUsdc([0.1, 0.0000001])).toBeNull();
    expect(sumRecordedUsdc([9007199254, 1])).toBeNull();
    expect(sumRecordedUsdc([])).toBe(BigInt(0));
  });

  it("never calls coercion hooks on untrusted missing or malformed values", () => {
    const malicious = { toString() { throw new Error("coercion attempted"); }, valueOf() { throw new Error("coercion attempted"); } };
    expect(formatRecordedUsdc(malicious)).toBe("Amount unavailable");
    expect(formatUsdcMicros(malicious)).toBe("Amount unavailable");
  });

  it("keeps every small canonical decimal value lossless", () => {
    for (let micros = 0; micros <= 10000; micros++) {
      expect(recordedUsdcMicros(micros / 1e6)).toBe(BigInt(micros));
    }
  });

  it("ships the exact canonical module in the unpacked extension", () => {
    const source = readFileSync(new URL("./recorded-usdc.mjs", import.meta.url));
    expect(source.equals(readFileSync(new URL("../../extension/recorded-usdc.mjs", import.meta.url)))).toBe(true);
  });
});
