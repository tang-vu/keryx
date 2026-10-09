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
