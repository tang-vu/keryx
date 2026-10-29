export const presentationLanguages = ["en", "vi", "pt", "pt-BR", "es", "fr"] as const;
export type RequestedPresentationLanguage = typeof presentationLanguages[number];
export const canonicalPresentationLanguages = Object.freeze(["en", "vi", "pt", "es", "fr"] as const);
export type PresentationLanguage = typeof canonicalPresentationLanguages[number];

/** Exact observed language only. Request aliases are not output evidence. */
export function isPresentationLanguage(value: unknown): value is PresentationLanguage {
  return canonicalPresentationLanguages.some(language => language === value);
}

/** Presentation support never enables a prepared/gated UI locale. */
export function presentationLanguage(value: unknown): PresentationLanguage | undefined {
  return value === "pt-BR" ? "pt" : isPresentationLanguage(value) ? value : undefined;
}
