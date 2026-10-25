import type { LiteratureEntry } from "./literature-workspace";

export const LITERATURE_SORTS = ["saved", "title", "year", "recent"] as const;
export type LiteratureSort = typeof LITERATURE_SORTS[number];
const titleOrder = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Sort only the view of retained metadata. Entries, exact paper identities and
 * persisted order stay unchanged; ties retain their original saved positions. */
export function sortLiteratureEntries(entries: readonly LiteratureEntry[], mode: LiteratureSort): LiteratureEntry[] {
  if (mode === "saved") return [...entries];
  const rows = entries.map((entry, index) => ({ entry, index,
    value: mode === "recent" ? Date.parse(entry.savedAt) : entry.paper.publishedYear }));
  return rows.sort((a, b) => {
    if (mode === "title") return titleOrder.compare(a.entry.paper.title, b.entry.paper.title) || a.index - b.index;
    const knownA = typeof a.value === "number" && Number.isFinite(a.value);
    const knownB = typeof b.value === "number" && Number.isFinite(b.value);
    if (knownA !== knownB) return knownA ? -1 : 1;
    return (knownA && knownB ? b.value! - a.value! : 0) || a.index - b.index;
  }).map(row => row.entry);
}
