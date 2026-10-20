import { literatureImportCopy as copy } from "../../locales/en/literature-import";
import { MAX_LITERATURE_BYTES, MAX_SAVED_PAPERS, parseLiteratureWorkspace, serializeLiteratureWorkspace, type LiteratureWorkspace } from "./literature-workspace";
import { createMessages } from "../i18n/messages";

const messages = createMessages("en");

/** Files must preserve their actual UTF-8 bytes, never silently repair metadata or notes. */
export function readLiteratureWorkspaceFile(bytes: Uint8Array): LiteratureWorkspace {
  if (bytes.byteLength > MAX_LITERATURE_BYTES) throw new Error(messages("paperWorkspace.backupLimit"));
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error(messages("paperWorkspace.unsupportedBackup")); }
  return parseLiteratureWorkspace(text);
}

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
