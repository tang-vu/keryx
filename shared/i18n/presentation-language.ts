export const presentationLanguages = ["en", "vi", "pt", "pt-BR", "es"] as const;
export type RequestedPresentationLanguage = typeof presentationLanguages[number];
export type PresentationLanguage = "en" | "vi" | "pt" | "es";

/** Presentation support never enables a prepared/gated UI locale. */
export function presentationLanguage(value: unknown): PresentationLanguage | undefined {
  return value === "pt-BR" ? "pt" : value === "en" || value === "vi" || value === "pt" || value === "es" ? value : undefined;
}
