export const presentationLanguages = ["en", "vi", "pt", "pt-BR", "es", "fr", "zh-Hans"] as const;
export type RequestedPresentationLanguage = typeof presentationLanguages[number];
export const canonicalPresentationLanguages = Object.freeze(["en", "vi", "pt", "es", "fr", "zh-Hans"] as const);
export type PresentationLanguage = typeof canonicalPresentationLanguages[number];

/** Exact observed language only. Request aliases are not output evidence. */
export function isPresentationLanguage(value: unknown): value is PresentationLanguage {
  return canonicalPresentationLanguages.some(language => language === value);
}

/** Presentation support never enables a prepared/gated UI locale. */
export function presentationLanguage(value: unknown): PresentationLanguage | undefined {
  return value === "pt-BR" ? "pt" : isPresentationLanguage(value) ? value : undefined;
}

/** System locale labels only. Explicit scripts win over regional defaults;
 * Traditional Chinese and Japanese never become Simplified Chinese evidence. */
export function systemPresentationLanguage(value: unknown): PresentationLanguage | undefined {
  if (typeof value !== "string") return undefined;
  const language = value.split(/[-_]/u)[0].toLowerCase();
  if (language !== "zh") return presentationLanguage(language);
  try {
    const locale = new Intl.Locale(value.replace(/_/gu, "-"));
    return locale.language === "zh" && locale.maximize().script === "Hans" ? "zh-Hans" : undefined;
  } catch { return undefined; }
}
