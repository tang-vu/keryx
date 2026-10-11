import { formatUsdcMicros } from "../display/recorded-usdc";
import type { UiLocale } from "./locales";

const intlLocales: Record<UiLocale, string> = { en: "en-US", vi: "vi-VN", "zh-Hans": "zh-CN" };
const unavailable = "Unavailable";

/** Exact display adapter over the existing bounded integer contract; never parses display back. */
export function formatLocalizedUsdc(micros: unknown, locale: UiLocale,
  minimumFractionDigits: 0 | 2 | 4 | 6 = 0): string {
  const canonical = formatUsdcMicros(micros, { denomination: "USDC", minimumFractionDigits });
  if (canonical === "Amount unavailable") return canonical;
  const [whole, fraction] = canonical.slice(0, -5).split(".");
  const format = new Intl.NumberFormat(intlLocales[locale], { useGrouping: true, maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat(intlLocales[locale]).formatToParts(1.1).find(part => part.type === "decimal")!.value;
  return `${format.format(BigInt(whole))}${fraction ? `${decimal}${fraction}` : ""} USDC`;
}

/** Verification text uses invariant decimal notation, no grouping, and an explicit currency. */
export function formatSigningUsdc(micros: unknown): string {
  return formatUsdcMicros(micros, { denomination: "USDC", minimumFractionDigits: 6 });
}

export function formatLocalizedNumber(value: number | bigint, locale: UiLocale): string {
  if (typeof value === "number" && !Number.isFinite(value)) return unavailable;
  return new Intl.NumberFormat(intlLocales[locale], { maximumFractionDigits: 6 }).format(value);
}

function instant(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().replace(".000Z", "Z") !== value.replace(".000Z", "Z")) return null;
  return date;
}

/** Explicit viewer zone avoids host-zone drift in SSR. UTC remains available for <time title>. */
export function formatLocalizedDate(utc: string, locale: UiLocale, timeZone: string): { text: string; utc: string } | null {
  const date = instant(utc);
  if (!date || typeof timeZone !== "string" || !timeZone || timeZone.length > 64) return null;
  try {
    return { text: new Intl.DateTimeFormat(intlLocales[locale], { timeZone, dateStyle: "medium", timeStyle: "short" }).format(date),
      utc: date.toISOString() };
  } catch { return null; }
}

/** Caller supplies its observed clock; no server/client Date.now mismatch or hidden scheduler. */
export function formatLocalizedRelativeTime(utc: string, nowUtc: string, locale: UiLocale): string {
  const date = instant(utc), now = instant(nowUtc);
  if (!date || !now) return unavailable;
  const seconds = (date.getTime() - now.getTime()) / 1000;
  const [unit, divisor]: [Intl.RelativeTimeFormatUnit, number] = Math.abs(seconds) < 60 ? ["second", 1]
    : Math.abs(seconds) < 3600 ? ["minute", 60] : Math.abs(seconds) < 86400 ? ["hour", 3600] : ["day", 86400];
  return new Intl.RelativeTimeFormat(intlLocales[locale], { numeric: "auto" }).format(Math.trunc(seconds / divisor), unit);
}

export function selectPlural(count: number, locale: UiLocale): Intl.LDMLPluralRule {
  if (!Number.isFinite(count) || count < 0) throw new Error("Plural count must be finite and nonnegative");
  return new Intl.PluralRules(intlLocales[locale]).select(count);
}

export type UsdcDisplayDigits = 0 | 2 | 4 | 6;

/** Recorded rows carry decimal USDC numbers; display always starts from their exact integer micro value. */
export function usdcDisplayMicros(usdc: unknown): bigint | null {
  if (typeof usdc !== "number" || !Number.isFinite(usdc)) return null;
  const micros = Math.round(Math.abs(usdc) * 1_000_000);
  if (!Number.isSafeInteger(micros)) return null;
  return BigInt(usdc < 0 ? -micros : micros);
}

/** Half-up display rounding on the integer; the result is text only and is never parsed back. */
function fixedUsdcParts(usdc: unknown, digits: UsdcDisplayDigits): { negative: boolean; whole: bigint; fraction: string } | null {
  const micros = usdcDisplayMicros(usdc);
  if (micros === null || ![0, 2, 4, 6].includes(digits)) return null;
  const zero = BigInt(0), ten = BigInt(10);
  const unit = ten ** BigInt(6 - digits), base = ten ** BigInt(digits);
  const scaled = ((micros < zero ? -micros : micros) + unit / BigInt(2)) / unit;
  return { negative: micros < zero && scaled !== zero, whole: scaled / base,
    fraction: digits ? (scaled % base).toString().padStart(digits, "0") : "" };
}

/** Bare amount with locale separators; the surrounding message supplies the currency. */
export function formatLocalizedUsdcAmount(usdc: unknown, locale: UiLocale, digits: UsdcDisplayDigits = 6): string {
  const parts = fixedUsdcParts(usdc, digits);
  if (!parts) return unavailable;
  const numbers = new Intl.NumberFormat(intlLocales[locale], { useGrouping: true, maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat(intlLocales[locale]).formatToParts(1.1).find(part => part.type === "decimal")!.value;
  return `${parts.negative ? "-" : ""}${numbers.format(parts.whole)}${parts.fraction ? `${decimal}${parts.fraction}` : ""}`;
}

/** Amounts a user verifies before signing: invariant decimal point and no grouping in every locale. */
export function formatVerifiableUsdcAmount(usdc: unknown, digits: UsdcDisplayDigits = 6): string {
  const parts = fixedUsdcParts(usdc, digits);
  if (!parts) return unavailable;
  return `${parts.negative ? "-" : ""}${parts.whole}${parts.fraction ? `.${parts.fraction}` : ""}`;
}

/** Trimmed display of up to six places, the shared replacement for ad-hoc trailing-zero stripping. */
export function formatLocalizedUsdcTrimmed(usdc: unknown, locale: UiLocale): string {
  const full = formatLocalizedUsdcAmount(usdc, locale, 6);
  if (full === unavailable) return full;
  const decimal = new Intl.NumberFormat(intlLocales[locale]).formatToParts(1.1).find(part => part.type === "decimal")!.value;
  const [whole, fraction = ""] = full.split(decimal);
  const kept = fraction.replace(/0+$/u, "");
  return kept ? `${whole}${decimal}${kept}` : whole === "-0" ? "0" : whole;
}

export function formatLocalizedDecimal(value: number, locale: UiLocale, fractionDigits: number): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return unavailable;
  return new Intl.NumberFormat(intlLocales[locale], { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }).format(value);
}

/** Ratio in, locale percent out (sign placement and spacing follow the locale). */
export function formatLocalizedPercent(ratio: number, locale: UiLocale, fractionDigits = 1, fixed = true): string {
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return unavailable;
  return new Intl.NumberFormat(intlLocales[locale], { style: "percent", minimumFractionDigits: fixed ? fractionDigits : 0,
    maximumFractionDigits: fractionDigits }).format(ratio);
}

export type InstantStyle = "date" | "monthDay" | "dateTime" | "dateTimeSeconds" | "dateTimeZone" | "dateTimeSecondsZone" | "time";
const instantStyles: Record<InstantStyle, Intl.DateTimeFormatOptions> = {
  date: { dateStyle: "medium" },
  monthDay: { month: "short", day: "numeric" },
  dateTime: { dateStyle: "medium", timeStyle: "short" },
  dateTimeSeconds: { dateStyle: "medium", timeStyle: "medium" },
  dateTimeZone: { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" },
  dateTimeSecondsZone: { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" },
  time: { timeStyle: "medium" },
};

/** Recorded instants (ISO text, epoch milliseconds or Date). Omitting the zone uses the rendering runtime's zone. */
export function formatLocalizedInstant(value: string | number | Date, locale: UiLocale, style: InstantStyle = "dateTime",
  timeZone?: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return unavailable;
  try {
    return new Intl.DateTimeFormat(intlLocales[locale], { ...instantStyles[style], ...(timeZone ? { timeZone } : {}) }).format(date);
  } catch { return unavailable; }
}

/** One locale-bound formatter set per module, mirroring createMessages. Display only: exports and APIs keep fixed formats. */
export function createFormatters(locale: UiLocale) {
  return Object.freeze({
    number: (value: number | bigint) => formatLocalizedNumber(value, locale),
    decimal: (value: number, fractionDigits: number) => formatLocalizedDecimal(value, locale, fractionDigits),
    percent: (ratio: number, fractionDigits = 1, fixed = true) => formatLocalizedPercent(ratio, locale, fractionDigits, fixed),
    usdc: (usdc: unknown, digits: UsdcDisplayDigits = 6) => formatLocalizedUsdcAmount(usdc, locale, digits),
    usdcTrimmed: (usdc: unknown) => formatLocalizedUsdcTrimmed(usdc, locale),
    usdcVerifiable: (usdc: unknown, digits: UsdcDisplayDigits = 6) => formatVerifiableUsdcAmount(usdc, digits),
    date: (value: string | number | Date, timeZone?: string) => formatLocalizedInstant(value, locale, "date", timeZone),
    dateTime: (value: string | number | Date, timeZone?: string) => formatLocalizedInstant(value, locale, "dateTime", timeZone),
    dateTimeSeconds: (value: string | number | Date, timeZone?: string) => formatLocalizedInstant(value, locale, "dateTimeSeconds", timeZone),
    time: (value: string | number | Date, timeZone?: string) => formatLocalizedInstant(value, locale, "time", timeZone),
    instant: (value: string | number | Date, style: InstantStyle, timeZone?: string) => formatLocalizedInstant(value, locale, style, timeZone),
    plural: (count: number) => selectPlural(count, locale),
  });
}
