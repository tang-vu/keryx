import { expect, it } from "vitest";
import { a2aUsdcFromMicros, exactA2aMicros } from "./amount-micros";

it("round-trips quoted integer micro-USDC including binary multiplication noise", () => {
  for (const amount of [0, 1, 123, 10_000, 15_700, 31_400, 65_700, 81_400, 500_000]) {
    expect(exactA2aMicros(a2aUsdcFromMicros(amount))).toBe(amount);
  }
  expect(Number.isInteger(0.0157 * 1e6)).toBe(false);
});

it("refuses genuinely fractional, negative, nonfinite and unsafe amounts", () => {
  for (const value of [0.0000001, 0.0157001, -0.01, NaN, Infinity, (Number.MAX_SAFE_INTEGER + 1) / 1e6])
    expect(exactA2aMicros(value)).toBeNull();
  for (const amount of [0.1, -1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(() => a2aUsdcFromMicros(amount)).toThrow("safe exact micro-USDC");
});
