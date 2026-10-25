import { emptyLiteratureWorkspace, parseLiteratureWorkspace, serializeLiteratureWorkspace, type LiteratureWorkspace } from "./literature-workspace";

export const hasSavedLiterature = (workspace: LiteratureWorkspace) => !!(workspace.title || workspace.question || workspace.entries.length);

/** Restore only into a still-empty library, or accept an already-restored exact
 * snapshot. New papers/focus/notes in this or another tab must never be replaced. */
export function restoreClearedLiterature(current: LiteratureWorkspace, saved: LiteratureWorkspace): LiteratureWorkspace {
  const currentSnapshot = parseLiteratureWorkspace(serializeLiteratureWorkspace(current));
  const savedSnapshot = parseLiteratureWorkspace(serializeLiteratureWorkspace(saved));
  const currentRaw = serializeLiteratureWorkspace(currentSnapshot), savedRaw = serializeLiteratureWorkspace(savedSnapshot);
  if (currentRaw !== savedRaw && currentRaw !== serializeLiteratureWorkspace(emptyLiteratureWorkspace())) throw new Error("library-changed");
  return savedSnapshot;
}
