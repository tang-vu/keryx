import type { ArchiveEntry } from "./answers-archive";
import { answersPagePath } from "./answers-pagination";

/** A recorded tag only; this never classifies question or answer text. */
export function archiveAnswerLanguage(entry: Pick<ArchiveEntry, "answerLanguage">): string {
  return parseArchiveLanguage(entry.answerLanguage) ?? "und";
}

/** Arrays, malformed tags and overly long query values do not select a language. */
export function parseArchiveLanguage(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64 || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(value)) return null;
  try { return Intl.getCanonicalLocales(value)[0] ?? null; } catch { return null; }
}

export function filterArchiveLanguage(entries: ArchiveEntry[], language: string | null): ArchiveEntry[] {
  return language === null ? entries : entries.filter(entry => archiveAnswerLanguage(entry) === language);
}

export function archiveLanguages(entries: ArchiveEntry[]): Array<{ language: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const language = archiveAnswerLanguage(entry);
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([language, count]) => ({ language, count }));
}

export function archiveLanguagePath(page: number, language: string | null): string {
  const path = answersPagePath(page);
  return language === null ? path : `${path}?${new URLSearchParams({ language })}`;
}
