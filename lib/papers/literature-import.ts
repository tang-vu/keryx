import { literatureImportCopy as copy } from "../../locales/en/literature-import";
import { MAX_SAVED_PAPERS, serializeLiteratureWorkspace, type LiteratureWorkspace } from "./literature-workspace";

/** Exact landing URLs are identities. Different versions remain distinct records. */
export function previewLiteratureImport(current: LiteratureWorkspace, incoming: LiteratureWorkspace) {
  const savedUrls = new Set(current.entries.map(entry => entry.paper.url));
  const additions = incoming.entries.filter(entry => !savedUrls.has(entry.paper.url));
  return { additions, duplicates: incoming.entries.length - additions.length, total: current.entries.length + additions.length };
}

/** Caller commits under the existing workspace lock. Preserve the current focus and first snapshots. */
export function addMissingLiteraturePapers(current: LiteratureWorkspace, incoming: LiteratureWorkspace): LiteratureWorkspace {
  serializeLiteratureWorkspace(current);
  serializeLiteratureWorkspace(incoming);
  const { additions, total } = previewLiteratureImport(current, incoming);
  if (total > MAX_SAVED_PAPERS) throw new Error(copy.capacity);
  if (additions.length === 0) return current;
  const combined = { ...current, entries: [...current.entries, ...additions] };
  serializeLiteratureWorkspace(combined);
  return combined;
}
