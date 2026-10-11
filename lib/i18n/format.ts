import { formatAmount, formatDate, formatNumber, formatRelativeTime, formatRecordedAmount, recordedUsdcMicros, formatCalendarDate, selectPlural,
  type DisplayLocale, type AmountOptions } from "../display/recorded-usdc.mjs";
import type { UiLocale } from "./locales";

// One browser-safe implementation also ships verbatim in the extension. No locale activation.
export { formatAmount, formatRecordedAmount, formatNumber, formatDate, formatCalendarDate, formatRelativeTime,
  formatSigningUsdc, formatSigningRecordedUsdc, selectPlural, resolveViewerTimeZone } from "../display/recorded-usdc.mjs";
export type { DisplayLocale, AmountOptions } from "../display/recorded-usdc.mjs";
// Accounting stays canonical; these integer values are never localized.
export { recordedUsdcMicros, sumRecordedUsdc } from "../display/recorded-usdc.mjs";
export { formatLocalizedRecordedUsdc as formatRecordedUsdc } from "../display/recorded-usdc.mjs";
export function formatUsdcMicros(value: unknown, options: AmountOptions = {}, locale: DisplayLocale = "en"): string {
  return formatAmount(value, { denomination: "$", ...options }, locale);
}

export function formatLocalizedUsdc(micros: unknown, locale: UiLocale,
  minimumFractionDigits: 0 | 2 | 4 | 6 = 0): string {
  return formatAmount(micros, { denomination: "USDC", minimumFractionDigits }, locale);
}
export function formatLocalizedNumber(value: number | bigint, locale: UiLocale): string {
  return formatNumber(value, {}, locale);
}
export function formatLocalizedDate(utc: string, locale: UiLocale, timeZone: string): { text: string; utc: string } | null {
  return formatDate(utc, locale, timeZone);
}
export function formatLocalizedRelativeTime(utc: string, nowUtc: string, locale: UiLocale): string {
  return formatRelativeTime(utc, nowUtc, locale);
}

// PR410's locale-bound public facade delegates to the strict canonical implementation.
// Money precision is a minimum, never permission to discard authoritative micro digits.
export type UsdcDisplayDigits = 0 | 2 | 4 | 6;
export const usdcDisplayMicros = recordedUsdcMicros;
export function formatLocalizedUsdcAmount(value: unknown, locale: UiLocale, digits: UsdcDisplayDigits = 6): string {
  const text = formatRecordedAmount(value, { minimumFractionDigits: digits }, locale);
  return text === "Amount unavailable" ? "Unavailable" : text;
}
export function formatVerifiableUsdcAmount(value: unknown, digits: UsdcDisplayDigits = 6): string {
  const text = formatRecordedAmount(value, { minimumFractionDigits: digits, useGrouping: false }, "en");
  return text === "Amount unavailable" ? "Unavailable" : text;
}
export function formatLocalizedUsdcTrimmed(value: unknown, locale: UiLocale): string {
  return formatLocalizedUsdcAmount(value, locale, 0);
}
export function formatLocalizedDecimal(value: number, locale: UiLocale, fractionDigits: number): string {
  return formatNumber(value, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }, locale);
}
export function formatLocalizedPercent(value: number, locale: UiLocale, fractionDigits = 1, fixed = true): string {
  return formatNumber(value, { style: "percent", minimumFractionDigits: fixed ? fractionDigits : 0, maximumFractionDigits: fractionDigits }, locale);
}
export type InstantStyle = "date" | "monthDay" | "dateTime" | "dateTimeSeconds" | "dateTimeZone" | "dateTimeSecondsZone" | "time";
const instantStyles: Record<InstantStyle, Intl.DateTimeFormatOptions> = {
  date: { timeStyle: undefined },
  monthDay: { dateStyle: undefined, timeStyle: undefined, month: "short", day: "numeric" },
  dateTime: {}, dateTimeSeconds: { timeStyle: "medium" },
  dateTimeZone: { dateStyle: undefined, timeStyle: undefined, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" },
  dateTimeSecondsZone: { dateStyle: undefined, timeStyle: undefined, year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" },
  time: { dateStyle: undefined, timeStyle: "medium" },
};
/** Validated recorded instant, or a calendar day for date-only display. Default UTC is SSR-stable.
 * Hydrated viewer-zone surfaces use DisplayTime, which retains the exact UTC detail. */
export function formatLocalizedInstant(value: string | number | Date, locale: UiLocale, style: InstantStyle = "dateTime", timeZone = "UTC"): string {
  if (!Object.hasOwn(instantStyles, style)) return "Unavailable";
  if (style === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value)) return formatCalendarDate(value, locale)?.text ?? "Unavailable";
  return formatDate(value instanceof Date ? value.getTime() : value, locale, timeZone, instantStyles[style])?.text ?? "Unavailable";
}
/** Preserved PR410 API; wrappers only, no alternative formatter or locale activation. */
export function createFormatters(locale: UiLocale) {
  return Object.freeze({
    number: (value: number | bigint) => formatLocalizedNumber(value, locale),
    decimal: (value: number, digits: number) => formatLocalizedDecimal(value, locale, digits),
    percent: (value: number, digits = 1, fixed = true) => formatLocalizedPercent(value, locale, digits, fixed),
    usdc: (value: unknown, digits: UsdcDisplayDigits = 6) => formatLocalizedUsdcAmount(value, locale, digits),
    usdcTrimmed: (value: unknown) => formatLocalizedUsdcTrimmed(value, locale),
    usdcVerifiable: (value: unknown, digits: UsdcDisplayDigits = 6) => formatVerifiableUsdcAmount(value, digits),
    date: (value: string | number | Date, zone?: string) => formatLocalizedInstant(value, locale, "date", zone),
    dateTime: (value: string | number | Date, zone?: string) => formatLocalizedInstant(value, locale, "dateTime", zone),
    dateTimeSeconds: (value: string | number | Date, zone?: string) => formatLocalizedInstant(value, locale, "dateTimeSeconds", zone),
    time: (value: string | number | Date, zone?: string) => formatLocalizedInstant(value, locale, "time", zone),
    instant: (value: string | number | Date, style: InstantStyle, zone?: string) => formatLocalizedInstant(value, locale, style, zone),
    plural: (value: number) => selectPlural(value, locale),
  });
}
