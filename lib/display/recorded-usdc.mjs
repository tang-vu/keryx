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

// Display locales are separate from UI activation. pt/es are shipped bot copy locales.
const DISPLAY_LOCALES = { en: "en-US", vi: "vi-VN", "zh-Hans": "zh-CN", pt: "pt-BR", es: "es-ES" };
function intlLocale(locale) {
  if (!Object.hasOwn(DISPLAY_LOCALES, locale)) throw new Error("Unsupported display locale");
  return DISPLAY_LOCALES[locale];
}

/** Exact display only: locale separators never enter payment data. */
export function formatAmount(micros, options = {}, locale = "en") {
  const canonical = formatUsdcMicros(micros, { ...options, denomination: "USDC" });
  if (canonical === UNAVAILABLE) return canonical;
  const [whole, fraction] = canonical.slice(0, -5).split(".");
  const language = intlLocale(locale);
  const wholeText = new Intl.NumberFormat(language, { useGrouping: options.useGrouping ?? true, maximumFractionDigits: 0 }).format(BigInt(whole));
  const decimal = new Intl.NumberFormat(language).formatToParts(1.1).find(part => part.type === "decimal").value;
  const amount = wholeText + (fraction ? decimal + fraction : "");
  return options.denomination === "$" ? "$" + amount : options.denomination ? amount + " " + options.denomination : amount;
}

/** Legacy adapter refuses fractional micro values; it never repairs accounting by rounding. */
export function formatRecordedAmount(value, options = {}, locale = "en") {
  return formatAmount(recordedUsdcMicros(value), options, locale);
}
export function formatLocalizedRecordedUsdc(value, options = {}, locale = "en") {
  return formatRecordedAmount(value, { denomination: "$", ...options }, locale);
}

/** Pre-sign display uses ungrouped decimal notation and an explicit currency code. */
export function formatSigningUsdc(micros) {
  return formatUsdcMicros(micros, { denomination: "USDC", minimumFractionDigits: 6 });
}
export function formatSigningRecordedUsdc(value) {
  return formatSigningUsdc(recordedUsdcMicros(value));
}

/** Metrics can round for display. Never use this to format monetary authority. */
export function formatNumber(value, options = {}, locale = "en") {
  if ((typeof value !== "number" && typeof value !== "bigint") || (typeof value === "number" && !Number.isFinite(value))) return "Unavailable";
  return new Intl.NumberFormat(intlLocale(locale), { maximumFractionDigits: 6, ...options }).format(value);
}

function instant(value) {
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isSafeInteger(value) && Number.isFinite(date.getTime()) ? { date, utc: date.toISOString() } : null;
  }
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-](\d{2}):(\d{2}))$/u.exec(value);
  if (!match || Number(match[4] ?? 0) > 23 || Number(match[5] ?? 0) > 59) return null;
  const wall = new Date(match[1] + "Z");
  if (!Number.isFinite(wall.getTime()) || wall.toISOString().slice(0, 19) !== match[1]) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  // Offset conversion is minute-exact; retain original sub-millisecond digits in UTC details.
  const fraction = (match[2] ?? "0").padEnd(3, "0");
  return { date, utc: date.toISOString().replace(/\.\d{3}Z$/u, "." + fraction + "Z") };
}

/** A publication day has no clock or viewer-zone conversion; do not invent an instant. */
export function formatCalendarDate(value, locale = "en") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return null;
  const date = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return { text: new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeZone: "UTC" }).format(date), date: value };
}

/** Explicit zone and retained UTC make SSR and the displayed instant unambiguous. */
export function formatDate(value, locale = "en", timeZone = "UTC", options = {}) {
  const observed = instant(value);
  if (!observed || typeof timeZone !== "string" || !timeZone || timeZone.length > 64) return null;
  try {
    return { text: new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium", timeStyle: "short", ...options, timeZone }).format(observed.date), utc: observed.utc };
  } catch { return null; }
}

/** Caller supplies its observation clock; no hidden timer or scheduler. */
export function formatRelativeTime(value, now, locale = "en") {
  const date = instant(value), clock = instant(now);
  if (!date || !clock) return "Unavailable";
  const seconds = (date.date.getTime() - clock.date.getTime()) / 1000;
  const [unit, divisor] = Math.abs(seconds) < 60 ? ["second", 1] : Math.abs(seconds) < 3600 ? ["minute", 60]
    : Math.abs(seconds) < 86400 ? ["hour", 3600] : ["day", 86400];
  return new Intl.RelativeTimeFormat(intlLocale(locale), { numeric: "auto" }).format(Math.trunc(seconds / divisor) || 0, unit);
}

export function selectPlural(count, locale = "en") {
  if (!Number.isFinite(count) || count < 0) throw new Error("Plural count must be finite and nonnegative");
  return new Intl.PluralRules(intlLocale(locale)).select(count);
}

/** Resolve the browser's viewer zone after hydration; never format text at the call site. */
export function resolveViewerTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
  catch { return "UTC"; }
}
