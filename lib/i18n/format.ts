import { formatAmount, formatDate, formatNumber, formatRelativeTime,
  type DisplayLocale, type AmountOptions } from "../display/recorded-usdc.mjs";
import type { UiLocale } from "./locales";

// One browser-safe implementation also ships verbatim in the extension. No locale activation.
export { formatAmount, formatRecordedAmount, formatNumber, formatDate, formatCalendarDate, formatRelativeTime,
  formatSigningUsdc, formatSigningRecordedUsdc, selectPlural } from "../display/recorded-usdc.mjs";
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
