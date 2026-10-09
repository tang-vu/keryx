/** Audit calculations use decimal integer strings; never round a signed or stored amount. */
export function micros(value: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,29})$/.test(value)) throw new Error("Invalid micro-USDC integer");
  return BigInt(value);
}

/** Legacy decimal fields are admissible only when their printed value is exactly representable. */
export function decimalMicros(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(value));
  if (!match) return null;
  const digits = match[1] + (match[2] ?? "");
  const places = 6 + Number(match[3] ?? 0) - (match[2]?.length ?? 0);
  if (places > 30 || places < -30) return null;
  let result = BigInt(digits);
  if (places >= 0) result *= BigInt(10) ** BigInt(places);
  else {
    const divisor = BigInt(10) ** BigInt(-places);
    if (result % divisor !== BigInt(0)) return null;
    result /= divisor;
  }
  const exact = result.toString();
  return exact.length <= 30 ? exact : null;
}

export function boundedRatio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}
