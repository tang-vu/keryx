const MICROS = 1_000_000;

/** Accept the canonical decimal representation of safe integer micro-USDC.
 * Multiplication alone can add binary floating-point noise (0.0157 * 1e6). */
export function exactA2aMicros(amountUsdc: number): number | null {
  const amount = Math.round(amountUsdc * MICROS);
  return Number.isSafeInteger(amount) && amount >= 0 && amountUsdc === amount / MICROS
    ? amount
    : null;
}

/** Quote construction and queued execution must agree before a buyer is charged. */
export function a2aUsdcFromMicros(amount: number): number {
  const value = amount / MICROS;
  if (!Number.isSafeInteger(amount) || amount < 0 || exactA2aMicros(value) !== amount)
    throw new Error("A2A price is not safe exact micro-USDC");
  return value;
}
