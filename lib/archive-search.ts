/** Fold search text only; original questions and publisher names stay untouched. */
export function normalizeArchiveSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim();
}

/** All words must occur, in any order, across the question and cited sources. */
export function archiveSearchWords(query: string): string[] {
  const normalized = normalizeArchiveSearch(query);
  return normalized ? [...new Set(normalized.split(" "))] : [];
}

export function matchesArchiveSearch(normalizedText: string, words: readonly string[]): boolean {
  return words.every((word) => normalizedText.includes(word));
}
