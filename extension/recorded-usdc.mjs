/** Recorded-money presentation only. Never use display text to sign, store or compare money. */
const MAX_MICROS = BigInt(Number.MAX_SAFE_INTEGER);
const UNAVAILABLE = "Amount unavailable";

function exactMicros(value) {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) return null;
    return BigInt(value);
  }
  if (typeof value === "string") {
    if (!/^(?:0|[1-9]\d{0,15})$/.test(value)) return null;
    value = BigInt(value);
  }
  return typeof value === "bigint" && value >= 0n && value <= MAX_MICROS ? value : null;
}

/** Legacy decimal numbers must describe a whole, safe micro-USDC amount; no rounding repair. */
export function recordedUsdcMicros(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || Object.is(value, -0)) return null;
  if (value === 0) return 0n;
  // Decimal parsing avoids binary multiplication noise (for example 0.0157 * 1e6).
  const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(value.toString());
  if (!match) return null;
  let digits = (match[1] + (match[2] ?? "")).replace(/^0+/, "");
  const scale = 6 + Number(match[3] ?? 0) - (match[2]?.length ?? 0);
  if (scale >= 0) {
    if (digits.length + scale > 16) return null;
    digits += "0".repeat(scale);
  } else {
    const fractional = -scale;
    if (fractional > digits.length || !digits.endsWith("0".repeat(fractional))) return null;
    digits = digits.slice(0, digits.length - fractional);
  }
  return exactMicros(digits || "0");
}

/** Exact integer input is authoritative; canonical integer strings are accepted without coercion. */
export function formatUsdcMicros(value, options = {}) {
  const micros = exactMicros(value);
  const minimum = options.minimumFractionDigits ?? 0;
  if (micros === null || ![0, 2, 4, 6].includes(minimum)) return UNAVAILABLE;
  const whole = (micros / 1_000_000n).toString();
  const fraction = (micros % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "").padEnd(minimum, "0");
  const amount = whole + (fraction ? `.${fraction}` : "");
  const denomination = options.denomination ?? "$";
  return denomination === "$" ? `$${amount}` : `${amount} ${denomination}`;
}

export function formatRecordedUsdc(value, options = {}) {
  return formatUsdcMicros(recordedUsdcMicros(value), options);
}

/** A recorded total is exact only when every leg is known and their integer sum stays safe. */
export function sumRecordedUsdc(values) {
  let total = 0n;
  for (const value of values) {
    const micros = recordedUsdcMicros(value);
    if (micros === null) return null;
    total += micros;
    if (total > MAX_MICROS) return null;
  }
  return total;
}
