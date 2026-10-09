import { preparedLocales, shippedUiLocales, type UiLocale } from "./locales";

function publicPath(path: string): string {
  if (!/^\/(?!\/)[A-Za-z0-9/_-]*$/u.test(path) || path.split("/").some(segment => segment === "." || segment === "..")) {
    throw new Error("A stable root-relative public URL is required");
  }
  return path;
}

/** Caller lists actual published variants; never manufactures URLs from locale preferences. */
export function publicLocaleAlternates(canonical: string, published: Partial<Record<UiLocale, string>>,
  enabled: readonly UiLocale[] = shippedUiLocales): {
  canonical: string; languages: Record<string, string>;
} {
  const path = publicPath(canonical);
  if (!Object.hasOwn(published, "en")) throw new Error("English public fallback is required");
  if (!enabled.includes("en") || enabled.some(locale => !preparedLocales.includes(locale))) throw new Error("Invalid published-locale allowlist");
  const languages: Record<string, string> = { "x-default": publicPath(published.en!) };
  for (const [locale, url] of Object.entries(published)) {
    if (!enabled.includes(locale as UiLocale) || typeof url !== "string") throw new Error("Unknown or disabled published locale");
    languages[locale] = publicPath(url);
  }
  if (!Object.values(published).includes(path)) throw new Error("Canonical URL must be a published variant");
  return { canonical: path, languages };
}

export interface ReportLanguageInput {
  id: string;
  visibility: "public" | "unlisted" | "private" | "unknown";
  /** Recorded output language. A viewer locale or the question's language is not evidence. */
  contentLanguage: string | null;
}

/** Admission boundary for future report/head/feed adapters; no DB enumeration or text guessing. */
export function publicReportLanguage(input: ReportLanguageInput): {
  canonical: string; contentLanguage: string; answerAttributes: { lang: string }; structuredData: { inLanguage?: string };
} | null {
  if (input.visibility !== "public") return null;
  if (!/^[A-Za-z0-9_-]{1,160}$/u.test(input.id)) throw new Error("Invalid public dispatch identity");
  let language = "und";
  if (input.contentLanguage !== null) {
    if (input.contentLanguage.length > 64 || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(input.contentLanguage)) {
      throw new Error("Invalid recorded content language");
    }
    try { language = Intl.getCanonicalLocales(input.contentLanguage)[0]; }
    catch { throw new Error("Invalid recorded content language"); }
  }
  return { canonical: `/dispatch/${input.id}`, contentLanguage: language, answerAttributes: { lang: language },
    structuredData: language === "und" ? {} : { inLanguage: language } };
}
