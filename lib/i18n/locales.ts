/** Prepared locales are not release authority. Only English UI currently ships. */
export const preparedLocales = ["en", "vi", "zh-Hans", "es", "pt-BR", "fr", "de", "ja", "ko", "hi", "id", "ru", "ar"] as const;
export type UiLocale = typeof preparedLocales[number];
export const shippedUiLocales: readonly UiLocale[] = ["en"];
/** Native names remain recognizable while a different interface language is selected. */
export const uiLocaleNames: Readonly<Record<UiLocale, string>> = {
  en: "English", vi: "Tiếng Việt (preview)", "zh-Hans": "简体中文 (preview)",
  es: "Español (preview)", "pt-BR": "Português do Brasil (preview)",
  fr: "Français (preview)", de: "Deutsch (preview)", ja: "日本語 (preview)",
  ko: "한국어 (preview)", hi: "हिन्दी (preview)", id: "Bahasa Indonesia (preview)",
  ru: "Русский (preview)",
  ar: "العربية (preview)",
};

export function normalizeUiLocale(value: unknown): UiLocale | null {
  if (typeof value !== "string" || value.length > 64 || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(value)) return null;
  try {
    const locale = new Intl.Locale(value);
    if (["en", "vi", "es", "fr", "de", "id"].includes(locale.language)) {
      return locale.script && locale.script !== "Latn" ? null : locale.language as UiLocale;
    }
    if (locale.language === "pt") return !locale.script || locale.script === "Latn" ? "pt-BR" : null;
    const scripted = { ja: "Jpan", ko: "Kore", hi: "Deva", ru: "Cyrl", ar: "Arab" } as const;
    if (Object.hasOwn(scripted, locale.language)) {
      const language = locale.language as keyof typeof scripted;
      return !locale.script || locale.script === scripted[language] ? language : null;
    }
    if (locale.language !== "zh" || locale.script === "Hant" || (!locale.script && ["TW", "HK", "MO"].includes(locale.region ?? ""))) return null;
    return !locale.script || locale.script === "Hans" ? "zh-Hans" : null;
  } catch { return null; }
}

export interface LocalePreferences {
  explicit?: unknown;
  stored?: unknown;
  acceptLanguage?: string | null;
}
export interface LocaleSelection { locale: UiLocale; source: "explicit" | "stored" | "header" | "default" }

/** Pure admission: never reads cookies, profiles, requests or browser state itself. */
export function negotiateUiLocale(preferences: LocalePreferences,
  enabled: readonly UiLocale[] = shippedUiLocales): LocaleSelection {
  const available = new Set(enabled);
  if (!available.has("en") || enabled.some(locale => !preparedLocales.includes(locale))) throw new Error("English fallback is required");
  for (const source of ["explicit", "stored"] as const) {
    const locale = normalizeUiLocale(preferences[source]);
    if (locale && available.has(locale)) return { locale, source };
  }
  const header = preferences.acceptLanguage;
  if (typeof header === "string" && header.length <= 4096) {
    const candidates = header.split(",").slice(0, 64).flatMap((part, index) => {
      const match = /^\s*([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*|\*)\s*(?:;\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?))?\s*$/u.exec(part);
      if (!match) return [];
      return [{ locale: normalizeUiLocale(match[1]), quality: match[2] === undefined ? 1 : Number(match[2]), index }];
    });
    // An explicit zero-quality locale must not re-enter through its region alias.
    const excluded = new Set(candidates.filter(entry => entry.quality === 0).map(entry => entry.locale));
    const preferred = candidates.filter(entry => entry.locale && entry.quality > 0 &&
      available.has(entry.locale) && !excluded.has(entry.locale))
      .sort((a, b) => b.quality - a.quality || a.index - b.index)[0];
    if (preferred?.locale) return { locale: preferred.locale, source: "header" };
  }
  return { locale: "en", source: "default" };
}

export function localeDirection(locale: UiLocale): "ltr" | "rtl" { return locale === "ar" ? "rtl" : "ltr"; }
